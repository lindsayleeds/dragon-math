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

// `runQuery` is a thunk issuing the trivial round trip. Returns the string that
// goes into `checks.db`: 'ok', 'error', or 'timeout' — deliberately coarse, so
// nothing about the connection or the failure leaks to a public caller.
async function probeDb(runQuery, timeoutMs = DB_TIMEOUT_MS) {
  let attempt;
  try {
    attempt = runQuery();
  } catch {
    // A synchronous throw (e.g. the pool is already ended) is still a failure.
    return 'error';
  }
  const result = await withTimeout(attempt, timeoutMs);
  return result.ok ? 'ok' : result.reason;
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
