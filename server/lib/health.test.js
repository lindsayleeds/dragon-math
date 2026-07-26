// Unit tests for the readiness primitives. No database, no socket, no express —
// the route test (server/routes/health.test.js) covers the wiring; this covers
// the bounding behaviour with short budgets so it stays fast.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withTimeout, probeDb, buildHealth } = require('./health.js');

describe('withTimeout', () => {
  it('reports success when the promise resolves in time', async () => {
    expect(await withTimeout(Promise.resolve('anything'), 500)).toEqual({ ok: true });
  });

  it('reports an error when the promise rejects', async () => {
    expect(await withTimeout(Promise.reject(new Error('nope')), 500)).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('resolves on the budget when the promise never settles', async () => {
    const started = process.hrtime.bigint();
    const result = await withTimeout(new Promise(() => {}), 50);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('swallows a rejection that lands after the timeout', async () => {
    let reject;
    const late = new Promise((_resolve, rej) => { reject = rej; });
    expect(await withTimeout(late, 20)).toEqual({ ok: false, reason: 'timeout' });
    // An unhandled rejection here would be fatal under
    // --unhandled-rejections=throw, so it must already be handled.
    reject(new Error('too late'));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
});

// Stand-in for a pooled pg client. `releases` records each release argument:
// undefined means "handed back to the pool", an Error means "pg destroys it".
function fakeClient(query) {
  const releases = [];
  return { releases, client: { query, release: err => releases.push(err) } };
}

describe('probeDb', () => {
  it('is "ok" on a successful round trip, and pools the client again', async () => {
    const fake = fakeClient(() => Promise.resolve({ rows: [{ n: 1 }] }));
    expect(await probeDb(() => Promise.resolve(fake.client), 500)).toBe('ok');
    expect(fake.releases).toEqual([undefined]);
  });

  it('is "error" when the query rejects, and destroys the client', async () => {
    const fake = fakeClient(() => Promise.reject(new Error('down')));
    expect(await probeDb(() => Promise.resolve(fake.client), 500)).toBe('error');
    expect(fake.releases).toHaveLength(1);
    expect(fake.releases[0]).toBeInstanceOf(Error);
  });

  it('is "error" when the checkout rejects', async () => {
    expect(await probeDb(() => Promise.reject(new Error('no connection')), 500)).toBe('error');
  });

  it('is "error" when the checkout throws synchronously', async () => {
    expect(await probeDb(() => { throw new Error('pool ended'); }, 500)).toBe('error');
  });

  it('is "timeout" when the query hangs, and destroys the stuck client', async () => {
    const fake = fakeClient(() => new Promise(() => {}));
    expect(await probeDb(() => Promise.resolve(fake.client), 30)).toBe('timeout');
    // Not returned to the pool with a query still in flight on the socket.
    expect(fake.releases).toHaveLength(1);
    expect(fake.releases[0]).toBeInstanceOf(Error);
  });

  it('destroys a client that arrives after the budget, without querying it', async () => {
    const fake = fakeClient(() => Promise.resolve({ rows: [] }));
    let handOver;
    const slowCheckout = new Promise(resolve => { handOver = resolve; });

    expect(await probeDb(() => slowCheckout, 30)).toBe('timeout');
    expect(fake.releases).toEqual([]); // nothing checked out yet, nothing to free

    handOver(fake.client);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fake.releases).toHaveLength(1);
    expect(fake.releases[0]).toBeInstanceOf(Error);
  });

  it('never releases a client twice', async () => {
    let settleQuery;
    const fake = fakeClient(() => new Promise(resolve => { settleQuery = resolve; }));
    expect(await probeDb(() => Promise.resolve(fake.client), 30)).toBe('timeout');

    // pg throws on a double release, so the late settlement must not release
    // again — nor surface as an unhandled rejection.
    settleQuery({ rows: [] });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fake.releases).toHaveLength(1);
  });

  it('survives a client whose release throws (pg already removed it)', async () => {
    const client = {
      query: () => Promise.reject(new Error('connection terminated')),
      release: () => { throw new Error('Release called on client which has already been released to the pool.'); },
    };
    expect(await probeDb(() => Promise.resolve(client), 500)).toBe('error');
  });
});

describe('buildHealth', () => {
  it('is ok only when every check passed', () => {
    expect(buildHealth({ checks: { db: 'ok' }, version: 'abc', uptimeSeconds: 7 })).toEqual({
      status: 'ok',
      version: 'abc',
      uptime: 7,
      checks: { db: 'ok' },
    });
    expect(buildHealth({ checks: { db: 'timeout' }, version: 'abc', uptimeSeconds: 7 }).status)
      .toBe('unhealthy');
    expect(buildHealth({ checks: { db: 'error' }, version: 'abc', uptimeSeconds: 7 }).status)
      .toBe('unhealthy');
  });
});
