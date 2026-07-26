// GET /api/health — the readiness probe the deploy script keys off.
//
// Covers the three cases that decide whether a bad release gets rolled back:
// database healthy (200), database down (503), and database *slow* (503 without
// hanging). The timeout path is the important one: if health blocked on a stuck
// query the deploy would wait instead of rolling back.
//
// health.js is CommonJS and destructures `db` from ../db at require time, so the
// fake is wired the plain Node way — the exported `db` object's `execute` is
// replaced in place (vi.mock cannot reach require() inside a CJS module here).
// Nothing below opens a real connection.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let server;
let baseUrl;
let execute; // swappable db.execute stub

beforeAll(async () => {
  // db.js throws unless DATABASE_URL is set. pg's Pool is lazy — it never
  // connects, because db.execute is replaced below.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.GIT_SHA = 'testsha0000000000000000000000000000000000';

  const dbModule = require('../db.js');
  dbModule.db.execute = (...args) => execute(...args);

  const express = require('express');
  const healthRouter = require('./health.js');

  const app = express();
  app.use('/api/health', healthRouter);

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

const getHealth = () => fetch(`${baseUrl}/api/health`);

describe('GET /api/health', () => {
  it('returns 200 and the expected body when the database is reachable', async () => {
    let seen = null;
    execute = query => {
      seen = query;
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    };

    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ db: 'ok' });
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);

    // A trivial round trip, not a table read.
    expect(JSON.stringify(seen)).toMatch(/select 1/);
  });

  it('is reachable with no credentials and must not be cached', async () => {
    execute = () => Promise.resolve({ rows: [] });
    const res = await getHealth();
    // No Authorization header, no x-admin-password — still 200, never 401/403.
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('returns 503 when the database is down', async () => {
    execute = () =>
      Promise.reject(
        Object.assign(
          new Error('connect ECONNREFUSED 10.1.2.3:5432 — postgres://admin:s3cret@db.internal/dragon'),
          { stack: 'Error: connect ECONNREFUSED\n    at Socket.emit (node:net:1234)' },
        ),
      );

    const res = await getHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.checks).toEqual({ db: 'error' });
  });

  it('returns 503 promptly when the database hangs, instead of waiting on it', async () => {
    const { DB_TIMEOUT_MS } = require('../lib/health.js');
    let settleHung;
    // Never settles on its own: exactly the stuck-socket case.
    execute = () => new Promise(resolve => { settleHung = resolve; });

    const started = process.hrtime.bigint();
    const res = await getHealth();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(res.status).toBe(503);
    expect((await res.json()).checks).toEqual({ db: 'timeout' });
    // Bounded: answered on the budget, not whenever the query felt like it.
    expect(elapsedMs).toBeGreaterThanOrEqual(DB_TIMEOUT_MS - 100);
    expect(elapsedMs).toBeLessThan(DB_TIMEOUT_MS + 1500);

    // The abandoned query settling afterwards must not blow up the process.
    settleHung({ rows: [] });
  }, 15_000);

  it('leaks nothing beyond the build id, uptime and check verdicts', async () => {
    execute = () => Promise.reject(new Error('password authentication failed for user "postgres"'));

    const res = await getHealth();
    const raw = await res.text();
    expect(res.status).toBe(503);

    // Whitelist the shape rather than blacklisting strings.
    const body = JSON.parse(raw);
    expect(Object.keys(body).sort()).toEqual(
      expect.arrayContaining(['checks', 'status', 'uptime', 'version']),
    );
    for (const key of Object.keys(body)) {
      expect(['status', 'version', 'uptime', 'checks', 'builtAt']).toContain(key);
    }
    for (const forbidden of [
      process.env.DATABASE_URL,
      'postgres://',
      'password',
      'ECONNREFUSED',
      'at Socket',
      'supabase',
    ]) {
      expect(raw.toLowerCase()).not.toContain(String(forbidden).toLowerCase());
    }
  });
});
