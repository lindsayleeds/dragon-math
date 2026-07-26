// Readiness probe primitives for GET /api/health.
//
// Kept free of db/express imports so the interesting behaviour — "the database
// check must be bounded and must always answer" — is testable without a
// database or a socket. The route wires these to the real pool.

// Default budget for the database round trip. The deploy script polls health
// every second or two, so the answer has to arrive well inside that.
const DB_TIMEOUT_MS = 2000;

// Race `promise` against a timer. Resolves `{ ok: true }` on success and
// `{ ok: false, reason }` on rejection *or* timeout — it never rejects and
// never resolves later than `timeoutMs`.
//
// A pg query that is stuck on a dead socket can settle long after we have
// answered, so both losing outcomes are swallowed explicitly: an unhandled
// rejection here would take the whole process down under --unhandled-rejections=throw.
function withTimeout(promise, timeoutMs) {
  let timer;
  const settled = Promise.resolve(promise).then(
    () => ({ ok: true }),
    () => ({ ok: false, reason: 'error' }),
  );
  const expired = new Promise(resolve => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
    // Don't hold the event loop open on this timer — it matters for tests and
    // for a clean pm2 shutdown.
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([settled, expired]).finally(() => clearTimeout(timer));
}

const PROBE_SQL = 'select 1';

// Handed to `client.release(err)` when we walk away from a probe. pg destroys a
// client released with an error instead of returning it to the pool, which is
// the point: a probe we stopped waiting for leaves a query in flight on that
// socket, so the connection has to go away with the request rather than sit
// checked out while every other route queues behind it.
function abandonedError() {
  return new Error('health probe abandoned: database check exceeded its budget');
}

// `connect` is a thunk that checks a client out of the pool. Both the checkout
// and the round trip sit inside the one budget — a black-holed socket can hang
// on the checkout just as easily as on the query — and the client's fate is
// always decided, exactly once. Returns the string that goes into `checks.db`:
// 'ok', 'error', or 'timeout' — deliberately coarse, so nothing about the
// connection or the failure leaks to a public caller.
async function probeDb(connect, timeoutMs = DB_TIMEOUT_MS) {
  let client = null;
  let answered = false;
  let released = false;

  const release = err => {
    if (released || !client) return;
    released = true;
    try {
      client.release(err);
    } catch {
      // pg throws on a double release, and on a client it already removed after
      // a connection-level error. Either way it is no longer in the pool.
    }
  };

  let attempt;
  try {
    attempt = (async () => {
      client = await connect();
      // The checkout itself can outlast the budget. If it did, the response is
      // already out: tear the connection down instead of running a query
      // nobody is waiting for.
      if (answered) {
        release(abandonedError());
        return;
      }
      await client.query(PROBE_SQL);
    })();
  } catch {
    // A synchronous throw (e.g. the pool is already ended) is still a failure.
    return 'error';
  }

  const result = await withTimeout(attempt, timeoutMs);
  answered = true;
  if (result.ok) {
    release();
    return 'ok';
  }
  // Both losing paths destroy the client rather than pool it: on 'timeout' a
  // query is still in flight on that socket, and a `select 1` that outright
  // failed means the connection itself is suspect.
  release(abandonedError());
  return result.reason;
}

// Assemble the response body. Healthy means every check reported 'ok'.
function buildHealth({ checks, version, uptimeSeconds }) {
  const healthy = Object.values(checks).every(v => v === 'ok');
  return {
    status: healthy ? 'ok' : 'unhealthy',
    version,
    uptime: uptimeSeconds,
    checks,
  };
}

module.exports = { DB_TIMEOUT_MS, withTimeout, probeDb, buildHealth };
