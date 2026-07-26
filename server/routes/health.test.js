// GET /api/health — the readiness probe the deploy script keys off.
//
// Covers the three cases that decide whether a bad release gets rolled back:
// database healthy (200), database down (503), and database *slow* (503 without
// hanging). The timeout path is the important one twice over: if health blocked
// on a stuck query the deploy would wait instead of rolling back, and if it
// walked away leaving the client checked out it would drain the pool the rest of
// the app shares — so the fate of the client is asserted, not just the status.
//
// health.js is CommonJS and destructures `pool` from ../db at require time, so
// the fake is wired the plain Node way — the exported `pool` object's `connect`
// is replaced in place (vi.mock cannot reach require() inside a CJS module
// here). Nothing below opens a real connection.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let server;
let baseUrl;
let connect; // swappable pool.connect stub

// A stand-in for a pooled pg client. `releases` records every release argument,
// which is how the tests tell "returned to the pool" (undefined) from
// "destroyed" (an Error) — pg only tears the socket down for the latter.
function fakeClient(query) {
  const releases = [];
  const queries = [];
  return {
    releases,
    queries,
    client: {
      query: (...args) => {
        queries.push(args[0]);
        return query(...args);
      },
      release: err => releases.push(err),
    },
  };
}

beforeAll(async () => {
  // db.js throws unless DATABASE_URL is set. pg's Pool is lazy — it never
  // connects, because pool.connect is replaced below.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.GIT_SHA = 'testsha0000000000000000000000000000000000';

  const dbModule = require('../db.js');
  dbModule.pool.connect = (...args) => connect(...args);

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
    const fake = fakeClient(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));
    connect = () => Promise.resolve(fake.client);

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
    expect(fake.queries).toEqual(['select 1']);
    // A healthy poll hands the connection back for reuse: released exactly
    // once, with no error, so pg pools it instead of destroying it.
    expect(fake.releases).toEqual([undefined]);
  });

  it('is reachable with no credentials and must not be cached', async () => {
    connect = () => Promise.resolve(fakeClient(() => Promise.resolve({ rows: [] })).client);
    const res = await getHealth();
    // No Authorization header, no x-admin-password — still 200, never 401/403.
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('returns 503 when the database is down', async () => {
    connect = () =>
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

  it('returns 503 promptly when the database hangs, and destroys that client', async () => {
    const { DB_TIMEOUT_MS } = require('../lib/health.js');
    let settleHung;
    // Never settles on its own: exactly the stuck-socket case.
    const fake = fakeClient(() => new Promise(resolve => { settleHung = resolve; }));
    connect = () => Promise.resolve(fake.client);

    const started = process.hrtime.bigint();
    const res = await getHealth();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(res.status).toBe(503);
    expect((await res.json()).checks).toEqual({ db: 'timeout' });
    // Bounded: answered on the budget, not whenever the query felt like it.
    expect(elapsedMs).toBeGreaterThanOrEqual(DB_TIMEOUT_MS - 100);
    expect(elapsedMs).toBeLessThan(DB_TIMEOUT_MS + 1500);

    // The client must not go back into the pool with a query still in flight on
    // it: released once, with an Error, which is what makes pg destroy it.
    expect(fake.releases).toHaveLength(1);
    expect(fake.releases[0]).toBeInstanceOf(Error);

    // The abandoned query settling afterwards must not blow up the process, nor
    // release the client a second time (pg throws on a double release).
    settleHung({ rows: [] });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fake.releases).toHaveLength(1);
  }, 15_000);

  it('returns 503 on a slow checkout, but keeps that untouched client pooled', async () => {
    // The pool is saturated rather than sick: the checkout only lands after the
    // budget. Same 503/'timeout' answer, but this connection is clean.
    const fake = fakeClient(() => Promise.resolve({ rows: [] }));
    let handOver;
    connect = () => new Promise(resolve => { handOver = resolve; });

    const res = await getHealth();
    expect(res.status).toBe(503);
    expect((await res.json()).checks).toEqual({ db: 'timeout' });

    handOver(fake.client);
    await new Promise(resolve => setTimeout(resolve, 20));
    // Never queried, so it is handed back for reuse — not destroyed, which
    // would force a fresh handshake exactly when the pool is most contended.
    expect(fake.queries).toEqual([]);
    expect(fake.releases).toEqual([undefined]);
  }, 15_000);

  it('leaks nothing beyond the build id, uptime and check verdicts', async () => {
    connect = () =>
      Promise.resolve(
        fakeClient(() =>
          Promise.reject(new Error('password authentication failed for user "postgres"')),
        ).client,
      );

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
