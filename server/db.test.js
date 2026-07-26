// Regression test for the pool 'error' listener in server/db.js.
//
// pg's Pool is an EventEmitter and emits 'error' when a client that is sitting
// IDLE in the pool dies (a Supabase failover terminates the backend with FATAL
// 57P01). With no listener attached, Node escalates that to an uncaught
// exception and the API process exits — the failure mode is a production crash,
// not a failing assertion, so it is pinned here.
//
// db.js is CommonJS, so it is loaded the plain Node way rather than with
// vi.mock (which cannot intercept require() inside a CJS module) — see
// server/routes/billing.portal.test.js. Nothing here opens a socket: pg's Pool
// is lazy and does not connect until a query or connect() asks it to.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// A password we can grep the log line for. db.js throws unless DATABASE_URL is
// set, and dotenv never overrides an already-set variable, so this is the value
// the Pool is built with.
const SECRET = 'nEvEr-lOg-mE';
const CONNECTION_STRING = `postgres://dm_user:${SECRET}@db.example.test:5432/dragonmath`;

let pool;

beforeAll(() => {
  process.env.DATABASE_URL = CONNECTION_STRING;
  pool = require('./db.js').pool;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// pg's own idle-client path: pool.emit('error', err, client).
function terminatedBackend() {
  const err = new Error('terminating connection due to administrator command');
  err.code = '57P01';
  err.severity = 'FATAL';
  return err;
}

describe("server/db.js pool 'error' listener", () => {
  it('is attached, so an idle-client failure cannot become an uncaught exception', () => {
    // Without a listener this emit throws and, at runtime, kills the process.
    expect(pool.listenerCount('error')).toBeGreaterThan(0);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => pool.emit('error', terminatedBackend(), { fake: 'client' })).not.toThrow();
  });

  it('logs the message and the pg error code so the failure is diagnosable', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    pool.emit('error', terminatedBackend(), { fake: 'client' });

    expect(logged).toHaveBeenCalledTimes(1);
    const line = logged.mock.calls[0].join(' ');
    expect(line).toContain('57P01');
    expect(line).toContain('terminating connection due to administrator command');
  });

  it('never leaks the connection string or its credentials into the log', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    // An error decorated with connection details, the way a driver-level
    // failure can arrive. Only the two chosen fields may reach the log.
    const err = terminatedBackend();
    err.connectionString = CONNECTION_STRING;
    err.password = SECRET;

    pool.emit('error', err, { fake: 'client' });

    const line = logged.mock.calls.map(args => args.join(' ')).join('\n');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain(CONNECTION_STRING);
    expect(line).not.toContain('dm_user');
  });

  it('survives an error with no message or code', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => pool.emit('error', new Error(''), undefined)).not.toThrow();
    expect(() => pool.emit('error', undefined, undefined)).not.toThrow();
  });
});
