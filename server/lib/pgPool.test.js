// Env parsing and SQL generation for the pool policy — the parts that can be
// checked without a database. The behaviour they configure (a slow query really
// being cancelled, the connection really coming back) is proved separately
// against a real Postgres in server/db.timeouts.test.js; a passing test here is
// not evidence that a timeout works.

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULTS, ENV_KEYS, poolSettings, sessionTimeoutSql, statementTimeoutSql } = require('./pgPool.js');

describe('poolSettings', () => {
  it('bounds the pool on every axis when the env is empty', () => {
    const { pool, session } = poolSettings({});

    // The four bounds the pool had none of before, plus the max it always had.
    expect(pool.max).toBe(10);
    expect(pool.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(pool.idleTimeoutMillis).toBeGreaterThan(0);
    expect(pool.keepAlive).toBe(true);
    expect(pool.keepAliveInitialDelayMillis).toBeGreaterThan(0);
    expect(session.statementTimeoutMs).toBeGreaterThan(0);
    expect(session.idleInTransactionTimeoutMs).toBeGreaterThan(0);
  });

  it('lets a caller wait for a connection no longer than a statement may run', () => {
    // Ordering that makes saturation fail fast instead of piling up: a caller
    // queued behind a full pool gives up before the query holding it would.
    const { pool, session } = poolSettings({});
    expect(pool.connectionTimeoutMillis).toBeLessThan(session.statementTimeoutMs);
  });

  it('keeps the statement timeout inside our own gateway-timeout headroom', () => {
    // So a stuck query surfaces as our error, not a gateway timeout. The ceiling
    // below is a self-imposed bound deliberately stricter than the
    // `proxy_read_timeout` nginx applies to `/api/`; docs/NGINX.md owns that
    // value, so it is not restated here.
    expect(poolSettings({}).session.statementTimeoutMs).toBeLessThan(60_000);
  });

  it('takes every value from the environment', () => {
    const { pool, session } = poolSettings({
      [ENV_KEYS.max]: '4',
      [ENV_KEYS.connectTimeoutMs]: '1500',
      [ENV_KEYS.idleTimeoutMs]: '2500',
      [ENV_KEYS.statementTimeoutMs]: '3500',
      [ENV_KEYS.idleInTransactionTimeoutMs]: '4500',
      [ENV_KEYS.keepAliveDelayMs]: '5500',
      [ENV_KEYS.longStatementTimeoutMs]: '6500',
    });

    expect(pool).toEqual({
      max: 4,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 2500,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5500,
    });
    expect(session).toEqual({
      statementTimeoutMs: 3500,
      idleInTransactionTimeoutMs: 4500,
      longStatementTimeoutMs: 6500,
    });
  });

  it('treats 0 as "off" so an operator can disable a bound without editing code', () => {
    const { pool, session } = poolSettings({
      [ENV_KEYS.connectTimeoutMs]: '0',
      [ENV_KEYS.keepAliveDelayMs]: '0',
      [ENV_KEYS.statementTimeoutMs]: '0',
    });

    // pg reads a falsy connectionTimeoutMillis as "wait forever".
    expect(pool.connectionTimeoutMillis).toBe(0);
    expect(pool.keepAlive).toBe(false);
    expect(session.statementTimeoutMs).toBe(0);
  });

  it('falls back to the default, loudly, rather than booting unbounded on a bad value', () => {
    const warn = vi.fn();
    for (const bad of ['', 'abc', '-1', '1.5', '10s']) {
      const { session } = poolSettings({ [ENV_KEYS.statementTimeoutMs]: bad }, { warn });
      expect(session.statementTimeoutMs).toBe(DEFAULTS.statementTimeoutMs);
    }
    // Empty string is "unset", not a typo, so it is the only one that stays quiet.
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0].join(' ')).toContain(ENV_KEYS.statementTimeoutMs);
  });

  it('refuses a pool size of 0, which would deadlock every request', () => {
    const warn = vi.fn();
    expect(poolSettings({ [ENV_KEYS.max]: '0' }, { warn }).pool.max).toBe(DEFAULTS.max);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('sessionTimeoutSql', () => {
  it('sets both guards on the connection', () => {
    expect(sessionTimeoutSql({ statementTimeoutMs: 15000, idleInTransactionTimeoutMs: 30000 }))
      .toBe('SET statement_timeout = 15000; SET idle_in_transaction_session_timeout = 30000');
  });

  it('emits nothing at all when both are disabled, so no round trip is spent', () => {
    expect(sessionTimeoutSql({ statementTimeoutMs: 0, idleInTransactionTimeoutMs: 0 })).toBeNull();
  });

  it('omits only the disabled one', () => {
    expect(sessionTimeoutSql({ statementTimeoutMs: 0, idleInTransactionTimeoutMs: 30000 }))
      .toBe('SET idle_in_transaction_session_timeout = 30000');
  });

  it('rejects a non-integer rather than interpolating it into SQL', () => {
    // These values reach the statement as bare text; readInt is what guarantees
    // they are integers, and this is the backstop if anything else calls in.
    expect(() => sessionTimeoutSql({ statementTimeoutMs: '15000; DROP TABLE users', idleInTransactionTimeoutMs: 0 }))
      .toThrow(TypeError);
    expect(() => sessionTimeoutSql({ statementTimeoutMs: 1.5, idleInTransactionTimeoutMs: 0 }))
      .toThrow(TypeError);
  });
});

describe('statementTimeoutSql', () => {
  it('always names statement_timeout, including when the value is 0', () => {
    // The difference from sessionTimeoutSql that withLongQueryBudget depends on:
    // a restore has to say "0" out loud, because on a connection carrying a
    // raised budget, omitting the GUC leaves that budget in place.
    expect(statementTimeoutSql(15000)).toBe('SET statement_timeout = 15000');
    expect(statementTimeoutSql(0)).toBe('SET statement_timeout = 0');
  });

  it('rejects a non-integer rather than interpolating it into SQL', () => {
    expect(() => statementTimeoutSql('60000; DROP TABLE users')).toThrow(TypeError);
    expect(() => statementTimeoutSql(-1)).toThrow(TypeError);
  });
});
