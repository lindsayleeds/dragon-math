// Tests for the Postgres-backed brute-force limiter. These run everywhere, with
// no database: a small emulator stands in for the `rate_limits` table and
// applies the real statement's semantics to the real statement's parameters
// (rendered through drizzle's own PgDialect, so a change to the SQL shows up
// here rather than passing silently).
//
// What the emulator can and cannot prove:
//  - It CAN prove that the limiter issues exactly one statement per call and
//    holds no process-local state, which is the whole point of the migration —
//    the "two workers" test below fails outright against the old in-memory Map.
//  - It CANNOT prove Postgres's row-level locking. That is covered by
//    rateLimit.pg.test.js, which runs the same scenarios against a real server
//    when TEST_DATABASE_URL is set.
//
// rateLimit.js is CommonJS and reads `../db` at require time, so `../db` is
// wired up the plain Node way rather than with vi.mock (see the note in
// AGENTS.md and server/routes/billing.portal.test.js).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { PgDialect } = require('drizzle-orm/pg-core');

// Read from the module under test (in beforeAll, once DATABASE_URL is set) rather
// than restated here, so the emulator can't drift from the real statement.
let SWEEP_GRACE_MS;
let MAX_KEY_LEN;

// --- the emulator ----------------------------------------------------------

// Models `rate_limits` plus the one statement that touches it. Every caller's
// statement is in flight before any of them applies (the `setTimeout` stands in
// for the round trip), and each then applies in a single uninterrupted turn —
// which is what Postgres's row lock buys the real thing. A read-then-write
// implementation would show up as two executes per call and would let the
// stalled readers through.
function makePgEmulator() {
  const dialect = new PgDialect();
  const table = new Map(); // key -> { windowStart, expiresAt, count }
  const state = { executes: 0, statements: [], now: Date.now(), failWith: null };

  async function execute(query) {
    const { sql: text, params } = dialect.sqlToQuery(query);
    state.executes += 1;
    state.statements.push(text);

    // Documented param order: SWEEP_GRACE_MS, key, SWEEP_BATCH, key, windowMs, limit.
    expect(params).toHaveLength(6);
    const [graceMs, sweepExcept, sweepBatch, key, windowMs, limit] = params;
    expect(sweepExcept).toBe(key);
    expect(graceMs).toBe(SWEEP_GRACE_MS);
    expect(Buffer.byteLength(key)).toBeLessThanOrEqual(MAX_KEY_LEN);

    await new Promise(resolve => setTimeout(resolve, 0));
    if (state.failWith) throw state.failWith;

    // ---- everything below is one atomic turn ----
    const now = state.now;

    // The `dead` CTE: oldest-expiry first, bounded, never this key.
    const dead = [...table.entries()]
      .filter(([k, r]) => k !== key && r.expiresAt < now - graceMs)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, sweepBatch);
    for (const [k] of dead) table.delete(k);

    // The upsert: fresh window, or count up and park one past the limit.
    const existing = table.get(key);
    const row = (!existing || existing.expiresAt < now)
      ? { windowStart: now, expiresAt: now + windowMs, count: 1 }
      : { ...existing, count: Math.min(existing.count + 1, limit + 1) };
    table.set(key, row);

    return { rows: [{ count: row.count, retry_after_ms: Math.max(0, row.expiresAt - now) }] };
  }

  return { execute, table, state };
}

// --- harness ---------------------------------------------------------------

let dbModule;
let emulator;
let originalExecute;

// A fresh module instance stands in for another server process: its own module
// scope, the same shared table underneath.
function loadWorker() {
  const path = require.resolve('./rateLimit.js');
  delete require.cache[path];
  return require(path);
}

beforeAll(() => {
  // db.js throws unless DATABASE_URL is set. pg's Pool is lazy and never
  // connects, because db.execute is replaced below.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  dbModule = require('../db.js');
  originalExecute = dbModule.db.execute;
  ({ SWEEP_GRACE_MS, MAX_KEY_LEN } = loadWorker());
});

afterAll(() => {
  if (originalExecute) dbModule.db.execute = originalExecute;
});

beforeEach(() => {
  emulator = makePgEmulator();
  // Patch in place: rateLimit.js destructures this same object at load time.
  dbModule.db.execute = emulator.execute;
});

// --- the multi-process property (the bug being fixed) ----------------------

describe('rateLimit across processes', () => {
  it('holds one shared limit when two independent workers share the store', async () => {
    // The regression this migration exists for: with a per-process Map, worker A
    // and worker B each allowed 8, so the login limit was really 16.
    const workerA = loadWorker();
    const workerB = loadWorker();
    expect(workerA).not.toBe(workerB); // genuinely separate module instances

    const attempt = (worker, name) =>
      worker.rateLimit({ key: 'login-email:victim@example.test', limit: 8, windowMs: 15 * 60 * 1000 })
        .then(res => ({ name, ...res }));

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await attempt(workerA, 'A'));
      results.push(await attempt(workerB, 'B'));
    }

    // 20 attempts, one limit of 8 — not 8 each.
    expect(results.filter(r => r.allowed)).toHaveLength(8);
    // And the allowance was spent across both, so neither is counting alone.
    expect(results.filter(r => r.allowed && r.name === 'A')).toHaveLength(4);
    expect(results.filter(r => r.allowed && r.name === 'B')).toHaveLength(4);
  });

  it('allows exactly `limit` when many callers race on the same key', async () => {
    const { rateLimit } = loadWorker();
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        rateLimit({ key: 'login-ip:203.0.113.7', limit: 20, windowMs: 15 * 60 * 1000 })),
    );

    expect(results.filter(r => r.allowed)).toHaveLength(20);
    // Every allowed caller got a distinct slot, so no two read the same count.
    expect(new Set(results.filter(r => r.allowed).map(r => r.remaining)).size).toBe(20);
    expect(emulator.table.get('login-ip:203.0.113.7').count).toBe(21);
  });

  it('counts with a single statement per call, not a read then a write', async () => {
    const { rateLimit } = loadWorker();
    await rateLimit({ key: 'signup:198.51.100.4', limit: 10, windowMs: 60 * 60 * 1000 });

    expect(emulator.state.executes).toBe(1);
    const stmt = emulator.state.statements[0];
    expect(stmt).toMatch(/INSERT INTO rate_limits/);
    expect(stmt).toMatch(/ON CONFLICT \(key\) DO UPDATE SET/);
    expect(stmt).toMatch(/RETURNING/);
    // The sweep must not queue behind another worker's sweep.
    expect(stmt).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
});

// --- fixed-window semantics (unchanged from the in-memory version) ---------

describe('rateLimit windows', () => {
  it('counts down remaining and then denies with a retry hint', async () => {
    const { rateLimit } = loadWorker();
    const call = () => rateLimit({ key: 'k', limit: 3, windowMs: 60 * 1000 });

    expect(await call()).toEqual({ allowed: true, remaining: 2 });
    expect(await call()).toEqual({ allowed: true, remaining: 1 });
    expect(await call()).toEqual({ allowed: true, remaining: 0 });
    expect(await call()).toEqual({ allowed: false, remaining: 0, retryAfterMs: 60 * 1000 });
  });

  it('resets once the window has fully elapsed, not before', async () => {
    const { rateLimit } = loadWorker();
    const call = () => rateLimit({ key: 'k', limit: 1, windowMs: 15 * 60 * 1000 });

    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(false);

    // Exactly at the boundary the window is still the old one — `now -
    // windowStart > windowMs` is what the in-memory version required too.
    emulator.state.now += 15 * 60 * 1000;
    expect((await call()).allowed).toBe(false);

    emulator.state.now += 1;
    const reopened = await call();
    expect(reopened).toEqual({ allowed: true, remaining: 0 });
    expect(emulator.table.get('k').count).toBe(1);
  });

  it('keeps a denied counter from growing without bound', async () => {
    const { rateLimit } = loadWorker();
    for (let i = 0; i < 50; i++) {
      await rateLimit({ key: 'k', limit: 5, windowMs: 60 * 1000 });
    }
    expect(emulator.table.get('k').count).toBe(6);
  });
});

// --- expiry of old rows ---------------------------------------------------

describe('rateLimit row expiry', () => {
  function seed(key, expiresAgoMs) {
    const now = emulator.state.now;
    emulator.table.set(key, { windowStart: now - expiresAgoMs, expiresAt: now - expiresAgoMs, count: 5 });
  }

  it('sweeps long-dead rows on the way past, and spares live ones', async () => {
    const { rateLimit } = loadWorker();
    for (let i = 0; i < 30; i++) seed(`dead:${i}`, 2 * SWEEP_GRACE_MS);
    seed('just-expired', 5 * 60 * 1000);
    emulator.table.set('live', {
      windowStart: emulator.state.now,
      expiresAt: emulator.state.now + 10 * 60 * 1000,
      count: 5,
    });

    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });

    expect([...emulator.table.keys()].filter(k => k.startsWith('dead:'))).toEqual([]);
    expect(emulator.table.has('live')).toBe(true);
    // Inside the grace window, so it is left for its owner to reset in place.
    expect(emulator.table.has('just-expired')).toBe(true);
  });

  it('bounds one call to SWEEP_BATCH rows so a login never pays for a backlog', async () => {
    const { rateLimit, SWEEP_BATCH } = loadWorker();
    const backlog = SWEEP_BATCH * 2 + 50;
    for (let i = 0; i < backlog; i++) seed(`dead:${i}`, 2 * SWEEP_GRACE_MS);

    const stillDead = () => [...emulator.table.keys()].filter(k => k.startsWith('dead:')).length;

    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });
    expect(stillDead()).toBe(backlog - SWEEP_BATCH);

    // The backlog drains over the next few calls rather than needing a timer.
    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });
    await rateLimit({ key: 'sweeper', limit: 5, windowMs: 60 * 1000 });
    expect(stillDead()).toBe(0);
  });

  it('revives a key whose own row was long dead instead of sweeping it mid-flight', async () => {
    const { rateLimit } = loadWorker();
    seed('comeback', 2 * SWEEP_GRACE_MS);

    const res = await rateLimit({ key: 'comeback', limit: 3, windowMs: 60 * 1000 });
    expect(res).toEqual({ allowed: true, remaining: 2 });
    expect(emulator.table.get('comeback').count).toBe(1);
  });
});

// --- over-long keys -------------------------------------------------------

// The key is request input and now a btree primary key. Left unbounded, a
// multi-kilobyte email makes the INSERT raise, which fail-open turns into an
// unlimited request on an unauthenticated endpoint — so these assert the limit
// still bites, not just that nothing throws.
describe('rateLimit with an over-long key', () => {
  const stored = () => [...emulator.table.keys()];

  it('still counts a multi-kilobyte key, and does not fail open', async () => {
    const { rateLimit } = loadWorker();
    const key = `login-email:${'a'.repeat(4000)}@example.test`;
    const call = () => rateLimit({ key, limit: 2, windowMs: 15 * 60 * 1000 });

    expect(await call()).toEqual({ allowed: true, remaining: 1 });
    expect(await call()).toEqual({ allowed: true, remaining: 0 });
    expect((await call()).allowed).toBe(false);

    // Hashed, not truncated, and the prefix survives so the row stays readable.
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatch(/^login-email:sha256:[0-9a-f]{64}$/);
    expect(Buffer.byteLength(stored()[0])).toBeLessThanOrEqual(MAX_KEY_LEN);
  });

  it('keeps two different over-long keys in different buckets', async () => {
    const { rateLimit } = loadWorker();
    const call = key => rateLimit({ key, limit: 1, windowMs: 15 * 60 * 1000 });

    expect((await call(`login-email:${'a'.repeat(4000)}`)).allowed).toBe(true);
    // A different long key must not inherit the first one's spent allowance.
    expect((await call(`login-email:${'b'.repeat(4000)}`)).allowed).toBe(true);
    expect((await call(`login-email:${'a'.repeat(4000)}`)).allowed).toBe(false);
    expect(stored()).toHaveLength(2);
  });

  it('measures the cap in bytes, not characters', async () => {
    const { rateLimit } = loadWorker();
    // 312 characters but 612 bytes: a character-length cap would let this past.
    const key = `login-email:${'é'.repeat(300)}`;
    expect(key.length).toBeLessThan(MAX_KEY_LEN);
    expect(Buffer.byteLength(key)).toBeGreaterThan(MAX_KEY_LEN);

    expect((await rateLimit({ key, limit: 1, windowMs: 60 * 1000 })).allowed).toBe(true);
    expect(stored()[0]).toMatch(/^login-email:sha256:[0-9a-f]{64}$/);
  });

  it('leaves keys inside the cap exactly as the caller wrote them', async () => {
    const { rateLimit } = loadWorker();
    const key = `login-email:${'a'.repeat(240)}@example.test`;
    await rateLimit({ key, limit: 8, windowMs: 15 * 60 * 1000 });
    expect(stored()).toEqual([key]);
  });
});

// --- behaviour when the database is unavailable ---------------------------

describe('rateLimit when the store is unreachable', () => {
  it('fails open rather than throwing into the request path', async () => {
    const { rateLimit } = loadWorker();
    emulator.state.failWith = new Error('connection terminated unexpectedly');

    const res = await rateLimit({ key: 'login-ip:203.0.113.9', limit: 8, windowMs: 15 * 60 * 1000 });
    // Deliberate: every caller is an auth path that needs the database anyway,
    // so refusing here would add an outage without adding protection.
    expect(res).toEqual({ allowed: true, remaining: 7 });
  });

  it('fails open on a missing table too, and recovers once the store returns', async () => {
    const { rateLimit } = loadWorker();
    emulator.state.failWith = Object.assign(
      new Error('relation "rate_limits" does not exist'), { code: '42P01' },
    );
    expect((await rateLimit({ key: 'k', limit: 2, windowMs: 60 * 1000 })).allowed).toBe(true);

    emulator.state.failWith = null;
    expect(await rateLimit({ key: 'k', limit: 2, windowMs: 60 * 1000 })).toEqual({ allowed: true, remaining: 1 });
    expect(await rateLimit({ key: 'k', limit: 2, windowMs: 60 * 1000 })).toEqual({ allowed: true, remaining: 0 });
    expect((await rateLimit({ key: 'k', limit: 2, windowMs: 60 * 1000 })).allowed).toBe(false);
  });

  it('never rejects, whatever the store throws', async () => {
    const { rateLimit } = loadWorker();
    for (const boom of [new Error('timeout'), Object.assign(new Error('deadlock detected'), { code: '40P01' })]) {
      emulator.state.failWith = boom;
      await expect(rateLimit({ key: 'k', limit: 1, windowMs: 1000 })).resolves.toMatchObject({ allowed: true });
    }
  });

  // The shared pool is bounded (server/lib/pgPool.js): a server-side
  // statement_timeout cancels a slow query with SQLSTATE 57014, and exhausting
  // the acquisition timeout rejects before a query is ever sent. Both surface as
  // a rejected db.execute on an auth path, and both must degrade to a normal
  // sign-in attempt rather than a 500 — the routes read `.allowed` off whatever
  // this resolves to, so a rejection here would escape into the request.
  it('fails open on the bounded pool\'s own failure modes', async () => {
    const { rateLimit } = loadWorker();

    const cancelled = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014', severity: 'ERROR', routine: 'ProcessInterrupts',
    });
    const acquisitionTimeout = new Error('timeout exceeded when trying to connect');

    for (const boom of [cancelled, acquisitionTimeout]) {
      emulator.state.failWith = boom;
      const res = await rateLimit({ key: 'login-email:someone@example.test', limit: 8, windowMs: 15 * 60 * 1000 });
      expect(res).toEqual({ allowed: true, remaining: 7 });
    }

    // And the limiter picks straight back up once the pool recovers, rather
    // than latching open.
    emulator.state.failWith = null;
    expect(await rateLimit({ key: 'login-email:someone@example.test', limit: 8, windowMs: 15 * 60 * 1000 }))
      .toEqual({ allowed: true, remaining: 7 });
  });

  it('keeps the key out of the degraded log', async () => {
    // Drizzle's DrizzleQueryError stringifies the statement and every bound
    // parameter into its own message, and the key here is a parent's email
    // address. An outage makes this log line fire on every sign-in attempt, so
    // logging the raw error would write the address of everyone trying to log
    // in into a non-privileged log.
    const { rateLimit } = loadWorker();
    const email = 'parent@example.test';

    const wrapped = new Error(
      `Failed query: INSERT INTO rate_limits ...\nparams: 3600000,login-email:${email},100`,
    );
    wrapped.cause = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    emulator.state.failWith = wrapped;

    const lines = [];
    const realError = console.error;
    console.error = (...args) => lines.push(args.join(' '));
    try {
      await rateLimit({ key: `login-email:${email}`, limit: 8, windowMs: 15 * 60 * 1000 });
    } finally {
      console.error = realError;
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(email);
    expect(lines[0]).not.toContain('params:');
    expect(lines[0]).not.toContain('INSERT INTO');
    // Still diagnosable: the SQLSTATE and the driver's own wording survive.
    expect(lines[0]).toContain('57014');
    expect(lines[0]).toContain('canceling statement due to statement timeout');
  });
});

// --- the call sites ------------------------------------------------------

// rateLimit() became async, so a call site that forgot to await it would read
// `allowed` off a Promise, get undefined, and 429 every single request. Cheap to
// audit from the source, and worth pinning: these are brute-force defences, so a
// silent drift in a limit or a window is a security change, not a tidy-up.
describe('rateLimit call sites', () => {
  const routesDir = fileURLToPath(new URL('../routes', import.meta.url));
  const sources = readdirSync(routesDir)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map(f => [f, readFileSync(join(routesDir, f), 'utf8')]);

  // A call is awaited either directly (`await rateLimit({...})`) or as a member
  // of an `await Promise.all([...])`, which is how the two paired counters on
  // the login and password-reset paths go out in one round trip.
  const callSites = sources.flatMap(([file, src]) => {
    const found = [];
    let insidePromiseAll = false;
    src.split('\n').forEach((raw, i) => {
      const text = raw.trim();
      if (/await Promise\.all\(\[/.test(text)) insidePromiseAll = true;
      if (text.includes('rateLimit({')) {
        found.push({
          file,
          line: i + 1,
          text,
          awaited: text.includes('await rateLimit({') || insidePromiseAll,
        });
      }
      if (insidePromiseAll && /^\]\)/.test(text)) insidePromiseAll = false;
    });
    return found;
  });

  const MINUTES_15 = 15 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const EXPECTED = {
    'login-ip':       [20, MINUTES_15],
    'login-email':    [8,  MINUTES_15],
    'forgot-ip':      [20, MINUTES_15],
    'forgot-email':   [5,  MINUTES_15],
    'child-login':    [30, MINUTES_15],
    'signup':         [10, HOUR],
    'verify-resend':  [5,  HOUR],
    'create-student': [60, HOUR],
    'class-join':     [20, HOUR],
    'school-import':  [10, HOUR],
    'school-join':    [20, HOUR],
    'tribe-create':   [10, HOUR],
    'tribe-join':     [20, HOUR],
    'create-child':   [20, HOUR],
    'link':           [10, HOUR],
    'proving-run':    [120, HOUR],
  };

  it('awaits every call', () => {
    expect(callSites).toHaveLength(Object.keys(EXPECTED).length);
    expect(callSites.filter(c => !c.awaited).map(c => `${c.file}:${c.line}`)).toEqual([]);
  });

  it('still applies the same limits and windows', () => {
    const seen = {};
    for (const { text } of callSites) {
      const prefix = text.match(/key: `([a-z-]+):/)[1];
      const limit = Number(text.match(/limit: (\d+)/)[1]);
      const windowMs = text.match(/windowMs: ([\d ]+(?:\* [\d ]+)*)/)[1]
        .split('*').reduce((product, n) => product * Number(n.trim()), 1);
      seen[prefix] = [limit, windowMs];
    }
    expect(seen).toEqual(EXPECTED);
  });
});
