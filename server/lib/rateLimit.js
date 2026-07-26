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

const { sql } = require('drizzle-orm');
const { db } = require('../db');

// Dead windows are cleared opportunistically by the same statement that bumps a
// counter, rather than by a timer, because a timer in every worker is the same
// multi-process problem this table exists to fix. SWEEP_BATCH caps how many rows
// one request will delete, so a long-idle table can't turn a login into a huge
// DELETE; the limiter is called often enough to drain any backlog over a handful
// of requests.
//
// SWEEP_GRACE is how long a dead window is left alone before it is collected.
// The Map version's GC dropped buckets an hour after the window opened, so an
// hour of slack past expiry is the same order of retention (a touch more
// conservative for the 1-hour windows), and it keeps the sweep away from rows
// another request is likely to be resetting right now.
const SWEEP_BATCH = 100;
const SWEEP_GRACE = "interval '1 hour'";

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
// Params, in order: key, SWEEP_BATCH, key, windowMs, limit.
function bumpQuery({ key, limit, windowMs }) {
  return sql`
    WITH dead AS (
      SELECT key FROM rate_limits
       WHERE expires_at < now() - ${sql.raw(SWEEP_GRACE)}
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

function logDegraded(err) {
  const now = Date.now();
  if (lastDegradedLogAt && now - lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
  lastDegradedLogAt = now;
  console.error('[rateLimit] counter store unavailable — allowing requests through:', err.message);
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
async function rateLimit({ key, limit, windowMs }) {
  try {
    const res = await db.execute(bumpQuery({ key, limit, windowMs }));
    const row = res.rows[0];
    if (!row) throw new Error('rate_limits bump returned no row');
    return decide(row, limit);
  } catch (err) {
    logDegraded(err);
    return { allowed: true, remaining: limit - 1 };
  }
}

module.exports = { rateLimit, bumpQuery, decide, SWEEP_BATCH, SWEEP_GRACE };
