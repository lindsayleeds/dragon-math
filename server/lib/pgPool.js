// Connection-pool policy for the shared Supabase Postgres pool.
//
// server/db.js owns exactly one pg Pool and roughly twenty route modules share
// it. Before this module the pool had no bounds of its own: no acquisition
// timeout, no server-side statement timeout, no TCP keepalive. One query that
// hung — a lock wait, a plan that went quadratic, a socket black-holed by a
// failover — held its connection until Supabase's own global cap noticed
// (2 minutes for the `postgres` role, per Supabase's timeouts guide), and ten
// of those emptied the pool for every user of the site rather than just the
// caller who triggered it. That is the failure this file closes.
//
// Deliberately separate from db.js and free of any connection at import time,
// so the policy can be unit-tested (env parsing) and integration-tested (a real
// pool against a throwaway Postgres) without pulling in the app's singleton.
//
// HOW THE STATEMENT TIMEOUT IS APPLIED, AND WHY NOT THE OBVIOUS WAY.
// pg accepts `statement_timeout` / `idle_in_transaction_session_timeout` as
// Pool config and sends them as *startup packet* parameters. Poolers are
// allowed to reject startup parameters they don't know — PgBouncer answers
// "unsupported startup parameter: statement_timeout" unless it is listed in
// `ignore_startup_parameters` — so routing our timeouts through the startup
// packet risks the connection itself, not just the timeout. We issue plain
// `SET` statements on each new connection instead. Supabase documents that a
// session-level `set statement_timeout` is honoured "with connections through
// Supavisor in session mode (port 5432) or a direct connection", which is
// exactly what DATABASE_URL points at (`...pooler.supabase.com:5432`; see the
// Database section of AGENTS.md). Session mode pins one Postgres backend to the
// client connection for its whole life, so the SET holds for every query that
// pooled connection later serves.
//
// NOT USED: pg's client-side `query_timeout`. It rejects the caller's promise
// but leaves the query running on the wire and the socket in the pool, so the
// next borrower can read someone else's result. A server-side statement_timeout
// has Postgres cancel the query and answer with 57014, which leaves the
// connection clean and reusable — see the integration test.

const { Pool } = require('pg');

// Defaults are chosen to be loose enough that nothing legitimate in this
// codebase can hit them (see the audit in the PR) and tight enough that a stuck
// query is a bounded incident. Every one is overridable by env so an operator
// can retune in seconds without a deploy of new code.
const DEFAULTS = {
  // Unchanged from the original pool. Listed here only so it becomes tunable.
  max: 10,
  // Time a caller may spend waiting for a connection — pg applies this both to
  // opening a new socket and to queueing for a busy pool. Shorter than the
  // statement timeout on purpose: when the pool is saturated, callers should
  // fail fast with a clear error instead of stacking up behind it.
  connectTimeoutMs: 10_000,
  // How long an unused connection may sit in the pool. Long enough to be reused
  // across a burst of traffic, short enough that we are rarely the one holding
  // a connection when Supabase's idle reaper or a failover kills it.
  idleTimeoutMs: 30_000,
  // The headline bound. Normal queries here run in single-digit milliseconds;
  // the slowest statements in the app (the admin roster reports) are indexed
  // aggregates well under a second. 15s is ~100x headroom over anything real
  // while still capping a stuck query at a fraction of Supabase's 2-minute
  // backstop. It also sits under nginx's 60s proxy_read_timeout, so a caller
  // gets a real error from us rather than a gateway timeout.
  statementTimeoutMs: 15_000,
  // statement_timeout does not cover a connection parked inside BEGIN with no
  // statement running, which holds a pool slot just as effectively. This does.
  idleInTransactionTimeoutMs: 30_000,
  // TCP keepalive probe delay. Without keepalive a connection killed silently
  // upstream (NAT idle reaping, a pooler restart) is only noticed when the OS
  // gives up, which is ~2 hours by default — the pool slot is dead the whole
  // time. 0 disables keepalive entirely.
  keepAliveDelayMs: 10_000,
  // The raised budget handed out by withLongQueryBudget(). Reserved for
  // operator-facing reports that may legitimately outgrow the default.
  longStatementTimeoutMs: 60_000,
};

const ENV_KEYS = {
  max: 'DB_POOL_MAX',
  connectTimeoutMs: 'DB_POOL_CONNECT_TIMEOUT_MS',
  idleTimeoutMs: 'DB_POOL_IDLE_TIMEOUT_MS',
  statementTimeoutMs: 'DB_STATEMENT_TIMEOUT_MS',
  idleInTransactionTimeoutMs: 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
  keepAliveDelayMs: 'DB_POOL_KEEPALIVE_DELAY_MS',
  longStatementTimeoutMs: 'DB_LONG_STATEMENT_TIMEOUT_MS',
};

// Read one non-negative integer. Anything unparseable falls back to the default
// and says so: a typo in a deploy's env must not quietly remove a bound, and it
// must not stop the process from booting either.
// `warn`/`log` default to *wrappers* rather than to console.warn/console.error
// themselves so that a test which swaps the console method still sees the call —
// capturing the function up front would pin the original.
function readInt(env, key, fallback, { min = 0, warn = (...a) => console.warn(...a) } = {}) {
  const raw = env[ENV_KEYS[key]];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    warn(`pg pool: ignoring ${ENV_KEYS[key]}="${raw}" (want an integer >= ${min}); using ${fallback}`);
    return fallback;
  }
  return n;
}

// Resolve env into the two halves of the policy: what pg's Pool constructor
// takes, and what has to be SET on the server once a connection exists.
function poolSettings(env = process.env, { warn } = {}) {
  const read = (key, opts) => readInt(env, key, DEFAULTS[key], { warn, ...opts });
  const keepAliveDelayMs = read('keepAliveDelayMs');

  return {
    pool: {
      max: read('max', { min: 1 }),
      connectionTimeoutMillis: read('connectTimeoutMs'),
      idleTimeoutMillis: read('idleTimeoutMs'),
      keepAlive: keepAliveDelayMs > 0,
      keepAliveInitialDelayMillis: keepAliveDelayMs,
    },
    session: {
      statementTimeoutMs: read('statementTimeoutMs'),
      idleInTransactionTimeoutMs: read('idleInTransactionTimeoutMs'),
      longStatementTimeoutMs: read('longStatementTimeoutMs'),
    },
  };
}

// The SET run on every new connection. Returns null when both timeouts are
// disabled (either set to 0) so the pool takes no per-connection round trip it
// doesn't need. Values are integers straight out of readInt — asserted here
// because they are interpolated into SQL, where a string would be an injection.
function sessionTimeoutSql({ statementTimeoutMs, idleInTransactionTimeoutMs }) {
  const statements = [];
  const add = (guc, ms) => {
    if (!Number.isInteger(ms) || ms < 0) throw new TypeError(`${guc} must be a non-negative integer`);
    if (ms > 0) statements.push(`SET ${guc} = ${ms}`);
  };
  add('statement_timeout', statementTimeoutMs);
  add('idle_in_transaction_session_timeout', idleInTransactionTimeoutMs);
  return statements.length ? statements.join('; ') : null;
}

// pg emits 'error' on the Pool when a client sitting IDLE in it dies — most
// often a Supabase failover or idle reaper terminating the backend (FATAL
// 57P01). The Pool is an EventEmitter, so with no listener attached Node turns
// that into an uncaught exception and the whole API process exits, taking every
// in-flight request with it. pg has already discarded the broken client by the
// time this fires, so the listener exists purely so the process survives:
// deliberately no reconnect, retry, or health tracking.
//
// Log two fields on purpose and nothing more. These logs are not privileged,
// and the error object (and anything derived from the pool config) can carry
// the connection string and its credentials — never widen this to `err` itself.
function attachIdleErrorListener(pool, log) {
  pool.on('error', (err) => {
    const code = err && err.code ? ` [${err.code}]` : '';
    const message = (err && err.message) || 'unknown error';
    log(`pg pool: idle client error${code}: ${message}`);
  });
}

// Build the pool. `onConnect` is pg-pool's awaited hook: it runs after the
// socket is up and before the client is handed to whoever asked for it, so
// there is no window in which a query could run on a connection that has not
// been bounded yet.
//
// It fails OPEN. A rejected onConnect makes pg end the client and fail the
// checkout, which would turn "the timeouts could not be applied" into "the
// database is unreachable" — a new way to take the site down, in a change whose
// whole point is to prevent one. A connection with no timeout is worse than one
// with, but it is far better than no connection, and the log line repeats on
// every new connection so the condition cannot hide.
function createPool({
  connectionString,
  env = process.env,
  log = (...a) => console.error(...a),
  warn = (...a) => console.warn(...a),
}) {
  const settings = poolSettings(env, { warn });
  const setupSql = sessionTimeoutSql(settings.session);

  const onConnect = setupSql
    ? async (client) => {
        try {
          await client.query(setupSql);
        } catch (err) {
          const code = err && err.code ? ` [${err.code}]` : '';
          const message = (err && err.message) || 'unknown error';
          log(`pg pool: could not apply session timeouts${code}: ${message}`);
        }
      }
    : undefined;

  const pool = new Pool({ connectionString, ...settings.pool, ...(onConnect ? { onConnect } : {}) });
  attachIdleErrorListener(pool, log);
  return { pool, settings };
}

module.exports = {
  DEFAULTS,
  ENV_KEYS,
  poolSettings,
  sessionTimeoutSql,
  createPool,
};
