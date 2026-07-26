// Fixed-window brute-force limiter, backed by Postgres so every server process
// enforces the same counter. This used to be an in-memory Map, which was only
// correct while exactly one process served traffic: under pm2 cluster mode each
// worker keeps its own bucket, so every limit is effectively multiplied by the
// worker count and which limit applies depends on which worker gets the
// request. The counters guard login / signup / password-reset, so that was a
// real weakening of a security control, not just untidiness.
//
// Semantics are unchanged from the Map version: a fixed window that starts on
// the first request for a key and resets once `windowMs` has fully elapsed
// (`now - windowStart > windowMs`). A sliding window would smooth out the
// burst-across-the-boundary case, but that is a behaviour change and
// deliberately not part of this fix.
//
// See server/db/schema.js `rateLimits` for the table.

const { createHash } = require('node:crypto');
const { sql } = require('drizzle-orm');
const { db } = require('../db');

// Keys are built from request input (an email, an ip), and they are now a
// durable btree primary key rather than a per-process Map entry. Two things
// follow. An index row over ~2704 bytes makes the INSERT raise, and because the
// limiter fails open that would silently turn the limit OFF for that request on
// an unauthenticated endpoint. And every distinct key is a row that lives until
// the sweep collects it, so unbounded keys are unbounded rows.
//
// MAX_KEY_LEN is in BYTES — a key of multi-byte characters is several times its
// character length — so the check below measures with Buffer.byteLength. An
// RFC-legal email is at most 254 characters and the longest prefix in use is
// 'login-email:' (12), so ~266 bytes is the real-world worst case; 320 leaves
// headroom and stays far below the btree limit.
const MAX_KEY_LEN = 320;

// An over-long key is hashed, not truncated: truncation would collapse many
// distinct inputs into one bucket, so an attacker could exhaust the bucket that
// legitimate keys share with them. The prefix up to the first ':' is kept for
// legibility (itself only when it is short enough to be a real prefix), and the
// digest covers the FULL original key, so distinct inputs stay in distinct
// buckets and the counting semantics are the same as for a short key.
const MAX_HASHED_PREFIX_LEN = 64;

function boundKey(rawKey) {
  const key = typeof rawKey === 'string' ? rawKey : String(rawKey);
  if (Buffer.byteLength(key) <= MAX_KEY_LEN) return key;
  const colon = key.indexOf(':');
  const prefix = colon === -1 ? '' : key.slice(0, colon + 1);
  const label = Buffer.byteLength(prefix) <= MAX_HASHED_PREFIX_LEN ? prefix : '';
  return `${label}sha256:${createHash('sha256').update(key).digest('hex')}`;
}

// Dead windows are cleared opportunistically by the same statement that bumps a
// counter, rather than by a timer, because a timer in every worker is the same
// multi-process problem this table exists to fix. SWEEP_BATCH caps how many rows
// one request will delete, so a long-idle table can't turn a login into a huge
// DELETE; the limiter is called often enough to drain any backlog over a handful
// of requests.
//
// SWEEP_GRACE_MS is how long a dead window is left alone before it is collected.
// The Map version's GC dropped buckets an hour after the window opened, so an
// hour of slack past expiry is the same order of retention (a touch more
// conservative for the 1-hour windows), and it keeps the sweep away from rows
// another request is likely to be resetting right now. It is a number the
// statement renders its interval from, so the tests can assert against the same
// value the SQL uses rather than a second copy of it.
const SWEEP_BATCH = 100;
const SWEEP_GRACE_MS = 60 * 60 * 1000;

// The one statement: collect a bounded batch of long-dead windows, then
// insert-or-bump this key's window and return the resulting count. It all runs
// in a single implicit transaction, and ON CONFLICT DO UPDATE takes a row lock
// on the key, so two workers bumping the same key at the same instant
// serialise — one sees 1, the other sees 2. Read-then-write is exactly the bug
// being fixed: both would read the same stale count and both would be allowed.
//
// `now()` is the transaction timestamp, so every comparison below sees one
// consistent instant (`clock_timestamp()` would not, and could reset
// window_start without resetting count). Nothing wraps rateLimit() in an
// explicit transaction, so that instant is the statement's own start time. The
// database clock is also the only clock every process agrees on.
//
// The sweep excludes this key: a data-modifying CTE and the main statement share
// one snapshot, so deleting the row the INSERT is about to conflict on inside
// the same statement is asking for trouble. It doesn't need to — an expired
// window for this key is reset by the CASE arms below, not left behind.
// FOR UPDATE SKIP LOCKED keeps concurrent sweeps off each other's rows instead
// of queueing on them.
//
// Params, in order: SWEEP_GRACE_MS, key, SWEEP_BATCH, key, windowMs, limit.
function bumpQuery({ key, limit, windowMs }) {
  return sql`
    WITH dead AS (
      SELECT key FROM rate_limits
       WHERE expires_at < now() - make_interval(secs => ${SWEEP_GRACE_MS}::double precision / 1000)
         AND key <> ${key}
       ORDER BY expires_at
       LIMIT ${SWEEP_BATCH}
       FOR UPDATE SKIP LOCKED
    ), swept AS (
      DELETE FROM rate_limits r USING dead d WHERE r.key = d.key
    )
    INSERT INTO rate_limits (key, window_start, expires_at, count)
    VALUES (
      ${key},
      now(),
      now() + make_interval(secs => ${windowMs}::double precision / 1000),
      1
    )
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE WHEN rate_limits.expires_at < now()
                          THEN excluded.window_start ELSE rate_limits.window_start END,
      expires_at   = CASE WHEN rate_limits.expires_at < now()
                          THEN excluded.expires_at   ELSE rate_limits.expires_at   END,
      -- Fresh window → 1. Otherwise count up, but stop one past the limit: the
      -- Map version never incremented a bucket that was already over, and
      -- parking the counter there keeps a sustained attack from growing it
      -- without bound while still reading as "denied".
      count        = CASE WHEN rate_limits.expires_at < now() THEN 1
                          ELSE LEAST(rate_limits.count + 1, ${limit} + 1) END
    RETURNING
      count,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (expires_at - now())) * 1000))::int
        AS retry_after_ms
  `;
}

// Pure: turn the bumped row into the caller's verdict. `count` is the value
// after this request was counted, so it is <= limit exactly while the request
// still fits inside the window's allowance.
function decide(row, limit) {
  const count = Number(row.count);
  if (count <= limit) return { allowed: true, remaining: Math.max(0, limit - count) };
  return { allowed: false, remaining: 0, retryAfterMs: Number(row.retry_after_ms) };
}

// A database outage would otherwise log once per request on every hot auth path.
const DEGRADED_LOG_INTERVAL_MS = 30 * 1000;
let lastDegradedLogAt = 0;

// Never log the thrown error itself. Drizzle raises a DrizzleQueryError whose
// message embeds the whole statement AND every bound parameter — and on these
// call sites a bound parameter is the key, which is a parent's email address.
// Unwrap to the driver error underneath, which carries the SQLSTATE and a
// message Postgres wrote, and if anything still looks like the wrapper fall
// back to the code on its own. Same rule as the idle-client listener in
// server/db.js: log the fields chosen on purpose, never `err`.
function describeStoreError(err) {
  const driver = err && err.cause ? err.cause : err;
  const code = (driver && driver.code) || (err && err.code) || 'no code';
  const raw = (driver && driver.message) || '';
  const message = !raw || raw.includes('Failed query:') ? '(details omitted)' : raw;
  return `[${code}] ${message}`;
}

function logDegraded(err) {
  const now = Date.now();
  if (lastDegradedLogAt && now - lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
  lastDegradedLogAt = now;
  console.error('[rateLimit] counter store unavailable — allowing requests through:', describeStoreError(err));
}

// rateLimit({ key, limit, windowMs }) -> { allowed, remaining, retryAfterMs? }
//
// Async now that the counter lives in Postgres; every call site awaits it.
//
// Fails OPEN when the store is unreachable. Every caller is an authentication
// path that already needs the database to do its job, so a database outage means
// those requests fail anyway: refusing them here adds no protection against
// brute force (there is nothing left to brute-force) while adding a
// self-inflicted outage. It also means the limiter degrades quietly if the
// rate_limits table has not been pushed yet, instead of taking sign-in down.
//
// `key` is bounded first: fail-open means any error from the bump statement is an
// unlimited request, so an over-long key must not be able to raise one.
async function rateLimit({ key, limit, windowMs }) {
  try {
    const res = await db.execute(bumpQuery({ key: boundKey(key), limit, windowMs }));
    const row = res.rows[0];
    if (!row) throw new Error('rate_limits bump returned no row');
    return decide(row, limit);
  } catch (err) {
    logDegraded(err);
    return { allowed: true, remaining: limit - 1 };
  }
}

module.exports = { rateLimit, SWEEP_BATCH, SWEEP_GRACE_MS, MAX_KEY_LEN };
