// End-to-end proof that the shared pool's bounds actually bound something.
//
// The failure this pins is an outage, not a wrong value: before server/db.js
// had any timeouts, one query that hung held its connection until Supabase's
// 2-minute global cap noticed, and `max` of them emptied the pool for every
// user of the site. So these tests do not inspect the config object — they run
// the real pool that server/db.js builds against a throwaway postgres:17-alpine,
// issue genuinely slow queries with pg_sleep, and assert that
//
//   (a) the query is cut off at the timeout,
//   (b) its connection goes back into the pool healthy and gets reused,
//   (c) the process survives, keeps answering /api/health, and recovers on its
//       own once the slow queries are cancelled.
//
// It also keeps the PR #8 coverage honest end to end: a backend killed while its
// client sits idle in the pool (FATAL 57P01, a Supabase failover) must be logged
// and survived, not escalated to an uncaught exception. server/db.test.js pins
// that at the unit level by emitting the event; here a real server really kills
// a real connection.
//
// Skips itself when docker is unavailable, and says so — a silent skip would
// read as coverage.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

const IMAGE = 'postgres:17-alpine';
const PASSWORD = 'dragonmath-test';

// Small, deliberately tight budgets: the same policy the app ships, scaled down
// so the tests run in seconds. The values themselves are unit-tested in
// server/lib/pgPool.test.js; what matters here is that they take effect.
const STATEMENT_TIMEOUT_MS = 1000;
const CONNECT_TIMEOUT_MS = 1000;
const LONG_TIMEOUT_MS = 8000;
const POOL_MAX = 2;

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAVE_DOCKER = dockerAvailable();
if (!HAVE_DOCKER) {
  console.warn(`[db.timeouts.test] docker not available — SKIPPING the pool timeout integration tests (${IMAGE} required)`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Poll until `check` returns truthy, or give up. Used instead of a fixed sleep
// so a slow container start doesn't turn into a flaky failure.
async function waitFor(check, { timeoutMs = 60_000, everyMs = 250, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

let containerId;
let pool;
let db;
let withLongQueryBudget;
let Client;
let server;
let baseUrl;

beforeAll(async () => {
  if (!HAVE_DOCKER) return;

  containerId = docker(
    'run', '-d', '--rm',
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-p', '127.0.0.1::5432',
    IMAGE,
    // Keep the server's own cap far above ours so anything we observe is our
    // statement_timeout and not the container's.
    '-c', 'statement_timeout=0',
  );

  // `docker port` prints "127.0.0.1:49xxx" for the published mapping.
  const port = docker('port', containerId, '5432/tcp').split('\n')[0].split(':').pop();
  const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`;

  await waitFor(
    () => {
      try {
        execFileSync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    { what: `${IMAGE} to accept connections` },
  );

  // Configure the real entrypoint through the env it reads, then load it fresh.
  // db.js is CommonJS and captures process.env at require time, so the cache
  // entry is dropped first (see server/routes/billing.portal.test.js for why
  // vi.mock is not an option for these modules).
  process.env.DATABASE_URL = url;
  process.env.DB_POOL_MAX = String(POOL_MAX);
  process.env.DB_POOL_CONNECT_TIMEOUT_MS = String(CONNECT_TIMEOUT_MS);
  process.env.DB_POOL_IDLE_TIMEOUT_MS = '30000';
  process.env.DB_STATEMENT_TIMEOUT_MS = String(STATEMENT_TIMEOUT_MS);
  process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = '2000';
  process.env.DB_LONG_STATEMENT_TIMEOUT_MS = String(LONG_TIMEOUT_MS);
  process.env.GIT_SHA = 'testsha0000000000000000000000000000000000';
  delete require.cache[require.resolve('./db.js')];

  ({ pool, db, withLongQueryBudget } = require('./db.js'));
  ({ Client } = require('pg'));

  // The real readiness probe, on the real pool — this is what proves the
  // process is still serving while the database is misbehaving.
  const express = require('express');
  const app = express();
  app.use('/api/health', require('./routes/health.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 180_000);

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end().catch(() => {});
  if (containerId) {
    try { docker('rm', '-f', containerId); } catch { /* already gone */ }
  }
}, 60_000);

// A rejection captured with its wall-clock cost, so "was it cut off at the
// timeout" can be asserted rather than assumed.
async function timedFailure(promise) {
  const started = Date.now();
  try {
    await promise;
    return { elapsed: Date.now() - started, error: null };
  } catch (error) {
    return { elapsed: Date.now() - started, error };
  }
}

describe.skipIf(!HAVE_DOCKER)('shared pg pool timeouts (against a real postgres)', () => {
  it('applies the timeouts to the connection itself, not just to the config', async () => {
    // The check the Supabase pooler question turns on. `SET` is issued per
    // connection precisely because a startup-packet parameter can be rejected
    // by a pooler; this reads the setting back off a live session.
    const { rows } = await pool.query('SHOW statement_timeout');
    expect(rows[0].statement_timeout).toBe('1s');

    const idle = await pool.query('SHOW idle_in_transaction_session_timeout');
    expect(idle.rows[0].idle_in_transaction_session_timeout).toBe('2s');
  });

  it('cuts off a slow query at the timeout instead of letting it hold a connection', async () => {
    const { elapsed, error } = await timedFailure(pool.query('SELECT pg_sleep(30)'));

    expect(error).toBeTruthy();
    // 57014 = query_canceled. Postgres cancelled it; we did not walk away from
    // a query still running on the wire.
    expect(error.code).toBe('57014');
    expect(error.message).toMatch(/statement timeout/i);
    // Would have been 30s unbounded. Generous upper bound for a loaded CI box.
    expect(elapsed).toBeLessThan(STATEMENT_TIMEOUT_MS + 4000);
  }, 40_000);

  it('frees the pool slot after a cancellation instead of leaking it', async () => {
    await pool.query('SELECT 1');
    const before = pool.totalCount;

    await expect(pool.query('SELECT pg_sleep(30)')).rejects.toMatchObject({ code: '57014' });

    // Nothing is left checked out — that leak is what would compound into an
    // outage. pool.query() hands the client back with the error, and pg treats
    // *any* errored query as reason to drop the socket rather than pool it, so
    // the slot is freed by destroying the connection rather than by returning
    // it. Either way the pool is immediately usable, and it is bounded again on
    // the connection it opens next.
    expect(pool.totalCount).toBeLessThanOrEqual(before);
    expect(pool.waitingCount).toBe(0);
    expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    expect((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('1s');
  }, 40_000);

  it('keeps a checked-out connection healthy and reusable after its query is cancelled', async () => {
    // The path the health probe and withLongQueryBudget take, and the one that
    // shows a cancellation really does leave a clean connection: Postgres
    // answered with an error and a ReadyForQuery, so the same backend serves
    // the next query.
    const client = await pool.connect();
    const before = pool.totalCount;
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    await expect(client.query('SELECT pg_sleep(30)')).rejects.toMatchObject({ code: '57014' });

    const after = await client.query('SELECT pg_backend_pid() AS pid');
    expect(after.rows[0].pid).toBe(pid);
    // Still carrying its budget, so the next borrower is bounded too.
    expect((await client.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('1s');

    client.release();
    expect(pool.totalCount).toBe(before);
    expect(pool.idleCount).toBeGreaterThan(0);
    expect((await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).toBe(pid);
  }, 40_000);

  it('recovers on its own after every connection is taken by a slow query', async () => {
    // The outage in miniature: fill the pool with hung queries.
    const hung = Array.from({ length: POOL_MAX }, () => timedFailure(pool.query('SELECT pg_sleep(30)')));

    const results = await Promise.all(hung);
    for (const { elapsed, error } of results) {
      expect(error?.code).toBe('57014');
      expect(elapsed).toBeLessThan(STATEMENT_TIMEOUT_MS + 4000);
    }

    // Unbounded, the site would have been down for the length of the queries.
    // Bounded, the pool is serving again a second later.
    expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  }, 60_000);

  it('fails a caller fast when the pool is saturated rather than queueing it forever', async () => {
    // Hold every slot open without running anything, so only the acquisition
    // timeout can end the wait.
    const held = await Promise.all(Array.from({ length: POOL_MAX }, () => pool.connect()));
    try {
      const { elapsed, error } = await timedFailure(pool.connect());
      expect(error?.message).toMatch(/timeout exceeded when trying to connect/i);
      expect(elapsed).toBeLessThan(CONNECT_TIMEOUT_MS + 3000);

      // The process is still up and answering — degraded, not hung. Health
      // reports the database check as failed instead of blocking the deploy.
      const started = Date.now();
      const res = await fetch(`${baseUrl}/api/health`);
      expect(Date.now() - started).toBeLessThan(6000);
      expect(res.status).toBe(503);
      expect((await res.json()).checks.db).not.toBe('ok');
    } finally {
      held.forEach(c => c.release());
    }

    // And back to normal the moment the slots free up.
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  }, 40_000);

  it('gives the /admin reports a longer budget without leaving it on the connection', async () => {
    const { sql } = require('drizzle-orm');

    // Would be cancelled at 1s on the shared pool; withLongQueryBudget raises it.
    const started = Date.now();
    const result = await withLongQueryBudget(tx => tx.execute(sql`SELECT 42 AS n, pg_sleep(2)`));
    expect(Date.now() - started).toBeGreaterThan(1900);
    // Same result shape the /admin routes read (`.rows`), off a Drizzle handle
    // bound to the checked-out client rather than the shared pool.
    expect(result.rows).toEqual([expect.objectContaining({ n: 42 })]);

    // The raised budget must not outlive the call — the next borrower of that
    // connection has to be back on the pool default.
    const { rows } = await pool.query('SHOW statement_timeout');
    expect(rows[0].statement_timeout).toBe('1s');

    // And the shared handle is still bounded. Drizzle wraps the pg error, so
    // the SQLSTATE is on the cause.
    await expect(db.execute(sql`SELECT pg_sleep(30)`))
      .rejects.toMatchObject({ cause: { code: '57014' } });
  }, 60_000);

  it('restores the raised budget to the pool default even when that default is "off"', async () => {
    // DB_STATEMENT_TIMEOUT_MS=0 is the documented way to disable the bound, and
    // it is the configuration where a restore derived from the per-connection
    // setup SQL breaks: that SQL omits a GUC set to 0, so the 60s budget rode the
    // connection back into the pool and the next borrower inherited it.
    const { sql } = require('drizzle-orm');
    const previous = process.env.DB_STATEMENT_TIMEOUT_MS;
    process.env.DB_STATEMENT_TIMEOUT_MS = '0';
    delete require.cache[require.resolve('./db.js')];
    // A second pool of its own, on the same container — the app's singleton was
    // built with the bound enabled and every other test here depends on that.
    const unbounded = require('./db.js');
    try {
      expect(unbounded.settings.session.statementTimeoutMs).toBe(0);

      await unbounded.withLongQueryBudget(tx => tx.execute(sql`SELECT 1`));

      // The client was released clean, so it is back in the pool and this lands
      // on it. Unbounded means '0' — not the raised budget it was lent.
      const { rows } = await unbounded.pool.query('SHOW statement_timeout');
      expect(rows[0].statement_timeout).toBe('0');
    } finally {
      await unbounded.pool.end().catch(() => {});
      if (previous === undefined) delete process.env.DB_STATEMENT_TIMEOUT_MS;
      else process.env.DB_STATEMENT_TIMEOUT_MS = previous;
      delete require.cache[require.resolve('./db.js')];
    }
  }, 40_000);

  it('fails a checkout fast when the session-timeout SET is never answered', async () => {
    // The post-handshake stall. pg-pool clears its own acquisition timer before
    // it awaits onConnect, and the setup statement runs on a connection that has
    // no statement_timeout yet, so an unanswered SET used to hang the checkout
    // for as long as the socket stayed open.
    //
    // Simulated against the real server rather than a fake pool: a plain TCP
    // proxy forwards everything except the setup query, which it swallows. The
    // connection is genuinely open and authenticated; nothing ever answers.
    const net = require('node:net');
    const { createPool } = require('./lib/pgPool.js');
    const upstream = new URL(process.env.DATABASE_URL);
    const SETUP_BUDGET_MS = 1000;

    const open = new Set();
    const proxy = net.createServer((client) => {
      const server = net.connect(Number(upstream.port), upstream.hostname);
      open.add(client).add(server);
      client.on('data', (chunk) => {
        // 0x51 = 'Q', a simple query. pg sends the SET as one, and it is the
        // only statement carrying this text on a brand-new connection.
        if (chunk[0] === 0x51 && chunk.includes('statement_timeout')) return;
        server.write(chunk);
      });
      server.on('data', chunk => client.write(chunk));
      const bin = () => { client.destroy(); server.destroy(); };
      client.on('error', bin).on('close', bin);
      server.on('error', bin).on('close', bin);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));

    const logged = [];
    const { pool: stalling } = createPool({
      connectionString: `postgres://postgres:${PASSWORD}@127.0.0.1:${proxy.address().port}/postgres`,
      env: { ...process.env, DB_POOL_CONNECT_TIMEOUT_MS: String(SETUP_BUDGET_MS) },
      log: (...a) => logged.push(a.join(' ')),
    });
    try {
      const { elapsed, error } = await timedFailure(stalling.connect());

      // A prompt, attributable error instead of an unbounded hang — and inside
      // the acquisition budget the caller already agreed to.
      expect(error).toBeTruthy();
      expect(elapsed).toBeLessThan(SETUP_BUDGET_MS + 3000);
      expect(logged.join('\n')).toMatch(/stalled applying session timeouts/i);

      // Nothing is left holding a slot: the client was dropped, not parked with
      // a query still on its wire.
      expect(stalling.waitingCount).toBe(0);
      await waitFor(() => stalling.totalCount === 0, { timeoutMs: 10_000, everyMs: 100, what: 'the stalled client to be discarded' });

      // And the process is still up and serving on the healthy pool.
      expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
    } finally {
      await stalling.end().catch(() => {});
      open.forEach(s => s.destroy());
      await new Promise(resolve => proxy.close(resolve));
    }
  }, 40_000);

  it('survives a backend killed while its client sits idle in the pool (FATAL 57P01)', async () => {
    // The regression from PR #8, end to end: without the pool 'error' listener
    // this kills the process instead of failing an assertion.
    const client = await pool.connect();
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    client.release();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const killer = new Client({ connectionString: process.env.DATABASE_URL });
    await killer.connect();
    try {
      await killer.query('SELECT pg_terminate_backend($1)', [pid]);
      await waitFor(() => logged.mock.calls.length > 0, { timeoutMs: 15_000, what: 'the pool to log the idle-client error' });
    } finally {
      await killer.end();
    }

    const line = logged.mock.calls.map(args => args.join(' ')).join('\n');
    logged.mockRestore();
    expect(line).toContain('idle client error');
    expect(line).not.toContain(PASSWORD);

    // Still alive, still serving.
    expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
  }, 40_000);

  it('closes connections that have been idle past the idle timeout', async () => {
    // A separate short-lived pool, because the app's own idle timeout is
    // deliberately too long to wait out in a test.
    const { createPool } = require('./lib/pgPool.js');
    const { pool: shortLived } = createPool({
      connectionString: process.env.DATABASE_URL,
      env: { ...process.env, DB_POOL_IDLE_TIMEOUT_MS: '300' },
    });
    try {
      await shortLived.query('SELECT 1');
      expect(shortLived.totalCount).toBe(1);
      await waitFor(() => shortLived.totalCount === 0, { timeoutMs: 10_000, everyMs: 100, what: 'the idle connection to be closed' });
    } finally {
      await shortLived.end();
    }
  }, 30_000);
});
