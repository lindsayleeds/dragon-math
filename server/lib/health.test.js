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

describe('probeDb', () => {
  it('is "ok" on a successful round trip', async () => {
    expect(await probeDb(() => Promise.resolve({ rows: [{ n: 1 }] }), 500)).toBe('ok');
  });

  it('is "error" when the query rejects', async () => {
    expect(await probeDb(() => Promise.reject(new Error('down')), 500)).toBe('error');
  });

  it('is "error" when the query throws synchronously', async () => {
    expect(await probeDb(() => { throw new Error('pool ended'); }, 500)).toBe('error');
  });

  it('is "timeout" when the query hangs', async () => {
    expect(await probeDb(() => new Promise(() => {}), 30)).toBe('timeout');
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
