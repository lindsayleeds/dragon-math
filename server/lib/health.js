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

// Handed to `client.release(err)` when a probe's round trip has to be written
// off. pg destroys a client released with an error instead of returning it to
// the pool, which is the point: a query we stopped waiting for is still in
// flight on that socket, and one that outright failed leaves the connection
// suspect — neither may sit checked out, or be handed to another route. A
// checkout that merely landed late has run nothing and is released normally.
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

  // A checkout that rejects *or* throws synchronously (e.g. the pool is already
  // ended) rejects `attempt`, which withTimeout reports as 'error'.
  const attempt = (async () => {
    client = await connect();
    // The checkout itself can outlast the budget. If it did, the response is
    // already out and nothing has run on this connection, so hand it straight
    // back unused rather than making the pool reconnect for nothing.
    if (answered) {
      release();
      return;
    }
    await client.query(PROBE_SQL);
  })();

  const result = await withTimeout(attempt, timeoutMs);
  answered = true;
  if (result.ok) {
    release();
    return 'ok';
  }
  // Reached only once a round trip has been issued on `client` — or with no
  // client at all, when the checkout itself failed, where this is a no-op — so
  // the connection is written off instead of pooled.
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
