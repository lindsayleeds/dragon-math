// Real-Postgres cover for the limiter. rateLimit.test.js proves everything that
// can be proved without a server; this file proves the one thing that cannot —
// that the bump statement is atomic under Postgres's own row locking, so two
// server processes sharing the database enforce one limit rather than one each.
//
// Opt-in, because there is no database in the default test environment:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/dragon_math_test npm test
//
// It TRUNCATES `rate_limits` between tests, so point it at a scratch database.
// It creates the table itself if it is missing (matching server/db/schema.js),
// so it does not need `drizzle-kit push` to have run first.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let pool;
let rateLimit;
let limiterPath;

suite('rateLimit against a real Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    limiterPath = fileURLToPath(new URL('./rateLimit.js', import.meta.url));
    ({ rateLimit } = require(limiterPath));
    ({ pool } = require('../db.js'));

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key text PRIMARY KEY,
        window_start timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        count integer NOT NULL DEFAULT 1
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits (expires_at)');
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE rate_limits');
  });

  const rows = async () => (await pool.query('SELECT key, count FROM rate_limits ORDER BY key')).rows;

  it('allows exactly `limit` when many connections race on one key', async () => {
    // Concurrent calls take separate pool connections, so Postgres sees them the
    // way it sees separate processes: interleaved, each in its own transaction.
    const results = await Promise.all(Array.from({ length: 40 }, () =>
      rateLimit({ key: 'login-email:victim@example.test', limit: 8, windowMs: 15 * 60 * 1000 })));

    expect(results.filter(r => r.allowed)).toHaveLength(8);
    expect(new Set(results.filter(r => r.allowed).map(r => r.remaining)).size).toBe(8);
    expect(await rows()).toEqual([{ key: 'login-email:victim@example.test', count: 9 }]);
  });

  it('allows exactly `limit` across two separate OS processes', async () => {
    // The literal deployment shape: two pm2 cluster workers, one database.
    const key = 'login-ip:203.0.113.11';
    const script = `
      process.env.DATABASE_URL = ${JSON.stringify(TEST_URL)};
      const { rateLimit } = require(${JSON.stringify(limiterPath)});
      const { pool } = require(${JSON.stringify(fileURLToPath(new URL('../db.js', import.meta.url)))});
      (async () => {
        const res = await Promise.all(Array.from({ length: 20 }, () =>
          rateLimit({ key: ${JSON.stringify(key)}, limit: 8, windowMs: 15 * 60 * 1000 })));
        process.stdout.write(String(res.filter(r => r.allowed).length));
        await pool.end();
      })();`;

    const run = () => new Promise((resolve, reject) => {
      execFile(process.execPath, ['-e', script], (err, stdout) =>
        err ? reject(err) : resolve(Number(stdout.trim().split('\n').pop())));
    });

    const [a, b] = await Promise.all([run(), run()]);
    expect(a + b).toBe(8);
    expect(await rows()).toEqual([{ key, count: 9 }]);
  });

  it('keeps the fixed window until it has fully elapsed', async () => {
    const call = () => rateLimit({ key: 'k', limit: 2, windowMs: 15 * 60 * 1000 });
    expect(await call()).toEqual({ allowed: true, remaining: 1 });
    expect(await call()).toEqual({ allowed: true, remaining: 0 });

    const denied = await call();
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(14 * 60 * 1000);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // Age the row past its window; the next call must open a fresh one.
    await pool.query(`UPDATE rate_limits
                         SET window_start = now() - interval '20 min',
                             expires_at   = now() - interval '5 min'
                       WHERE key = 'k'`);
    expect(await call()).toEqual({ allowed: true, remaining: 1 });
    expect(await rows()).toEqual([{ key: 'k', count: 1 }]);
  });

  it('sweeps long-dead rows opportunistically, in bounded batches', async () => {
    const { SWEEP_BATCH } = require(limiterPath);
    await pool.query(`INSERT INTO rate_limits (key, window_start, expires_at, count)
                      SELECT 'dead:' || g, now() - interval '3 h', now() - interval '2 h', 5
                        FROM generate_series(1, ${SWEEP_BATCH + 20}) g`);
    await pool.query(`INSERT INTO rate_limits (key, window_start, expires_at, count) VALUES
                        ('live',         now(),                   now() + interval '10 min', 5),
                        ('just-expired', now() - interval '20 min', now() - interval '5 min', 5)`);

    const dead = async () =>
      (await pool.query("SELECT count(*)::int n FROM rate_limits WHERE key LIKE 'dead:%'")).rows[0].n;

    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });
    expect(await dead()).toBe(20);

    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });
    expect(await dead()).toBe(0);

    const left = (await rows()).map(r => r.key);
    expect(left).toContain('live');
    // Inside the grace window: left for its own key to reset in place.
    expect(left).toContain('just-expired');
  });

  it('does not deadlock when concurrent calls revive rows another call is sweeping', async () => {
    await pool.query(`INSERT INTO rate_limits (key, window_start, expires_at, count)
                      SELECT 'old' || g, now() - interval '3 h', now() - interval '2 h', 1
                        FROM generate_series(1, 500) g`);

    const results = await Promise.all(Array.from({ length: 24 }, (_, i) =>
      rateLimit({ key: `old${i + 1}`, limit: 2, windowMs: 60 * 1000 })));

    // A deadlock would surface as a fail-open allow with the row left untouched,
    // so assert the rows really were reset as well as the verdicts.
    expect(results.every(r => r.allowed && r.remaining === 1)).toBe(true);
    const revived = (await pool.query(
      "SELECT count(*)::int n FROM rate_limits WHERE key LIKE 'old%' AND count = 1 AND expires_at > now()",
    )).rows[0].n;
    expect(revived).toBe(24);
  });

  it('fails open when the database goes away mid-flight', async () => {
    const dbModule = require('../db.js');
    const real = dbModule.db.execute;
    dbModule.db.execute = () => Promise.reject(new Error('connection terminated unexpectedly'));
    try {
      const res = await rateLimit({ key: 'k', limit: 8, windowMs: 15 * 60 * 1000 });
      expect(res).toEqual({ allowed: true, remaining: 7 });
      expect(await rows()).toEqual([]);
    } finally {
      dbModule.db.execute = real;
    }
  });
});
