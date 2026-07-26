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
  // backstop. It also sits well under the `proxy_read_timeout` nginx applies to
  // `/api/` (docs/NGINX.md records that config, which lives outside this repo),
  // so a caller gets a real error from us rather than a gateway timeout.
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

// These values reach the statement as bare text, so every path that builds one
// asserts the integer here rather than trusting its caller: readInt is what
// normally guarantees it, and this is the backstop if anything else calls in.
function assertTimeoutMs(guc, ms) {
  if (!Number.isInteger(ms) || ms < 0) throw new TypeError(`${guc} must be a non-negative integer`);
}

// The SET run on every new connection. Returns null when both timeouts are
// disabled (either set to 0) so the pool takes no per-connection round trip it
// doesn't need — a fresh connection already has no bound, so there is nothing to
// say.
function sessionTimeoutSql({ statementTimeoutMs, idleInTransactionTimeoutMs }) {
  const statements = [];
  const add = (guc, ms) => {
    assertTimeoutMs(guc, ms);
    if (ms > 0) statements.push(`SET ${guc} = ${ms}`);
  };
  add('statement_timeout', statementTimeoutMs);
  add('idle_in_transaction_session_timeout', idleInTransactionTimeoutMs);
  return statements.length ? statements.join('; ') : null;
}

// One `SET statement_timeout`, always emitted — including for 0, which is the
// documented way to disable the bound. That is the whole difference from
// sessionTimeoutSql above, and the reason this exists separately: omitting a
// disabled GUC is right for *setting up* a connection that has no bound yet, and
// wrong for *restoring* one whose budget was raised, where saying nothing leaves
// the raised value in place. Used by withLongQueryBudget in server/db.js for
// both halves of its round trip.
function statementTimeoutSql(ms) {
  assertTimeoutMs('statement_timeout', ms);
  return `SET statement_timeout = ${ms}`;
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

// Raised when the setup round trip was never answered, to tell that apart from
// the server answering it with an error. The two want opposite handling; see
// createPool below.
class StalledSetupError extends Error {
  constructor(budgetMs) {
    super(`session timeouts were not acknowledged within ${budgetMs}ms`);
    this.name = 'StalledSetupError';
    this.budgetMs = budgetMs;
  }
}

// Run the setup SET under a budget. pg-pool clears its own
// connectionTimeoutMillis timer before it awaits onConnect, and by construction
// this statement runs on a connection that does not have a statement_timeout
// yet, so without this nothing bounds it at all: a server that finishes the
// handshake and then stops answering (the failover / pooler-under-load case)
// leaves the checkout pending and the client holding a pool slot until TCP
// keepalive gives up, minutes later.
//
// The budget is the already-resolved connection-acquisition budget rather than a
// new knob — this round trip is part of getting a connection, and a caller that
// agreed to wait 10s for one should not wait longer because of it. 0 means "wait
// forever" everywhere else in this policy, so it means that here too; this must
// not become the one place that quietly ignores it.
async function applySetupSql(client, sql, budgetMs) {
  const query = client.query(sql);
  if (!budgetMs) return query;

  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StalledSetupError(budgetMs)), budgetMs);
    // Don't hold the event loop open on this timer — same reason as
    // withTimeout in server/lib/health.js.
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([query, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

// Destroy the socket under a client whose setup query is still unanswered.
// Ending it politely would queue a Terminate behind that query on a connection
// that is demonstrably not answering; the point here is that nothing is left in
// flight. The no-op 'error' listener goes on first because pg emits 'error' on a
// client whose connection dies under a pending query, and an EventEmitter with
// no listener for it throws — the process death this file exists to prevent.
function destroyStalledClient(client) {
  try {
    client.on('error', () => {});
    const stream = client.connection && client.connection.stream;
    if (stream && typeof stream.destroy === 'function') stream.destroy();
  } catch {
    // Already gone, or a client shape we don't recognise. Either way the hook
    // below still rejects, which is what fails the checkout.
  }
}

// Build the pool. `onConnect` is pg-pool's awaited hook: it runs after the
// socket is up and before the client is handed to whoever asked for it, so
// there is no window in which a query could run on a connection that has not
// been bounded yet.
//
// The two ways the setup can fail want opposite answers:
//
// The server ANSWERS the SET with an error — an unknown GUC, a pooler refusing
// it. The connection is clean and usable, just unbounded, so this fails OPEN. A
// rejected onConnect makes pg end the client and fail the checkout, which would
// turn "the timeouts could not be applied" into "the database is unreachable" —
// a new way to take the site down, in a change whose whole point is to prevent
// one. A connection with no timeout is worse than one with, but far better than
// no connection, and the log line repeats on every new connection so the
// condition cannot hide. This is the Supavisor-compatibility case.
//
// The server does NOT answer at all inside the budget. Then the connection is
// provably unusable and there is an unanswered statement on the wire — and pg
// serialises queries per client, so handing it over anyway would only park the
// caller's first query behind the stalled SET. That is precisely the
// query_timeout footgun rejected at the top of this file, moved from connect()
// into query() where it is past the acquisition timeout and harder to attribute.
// So this fails CLOSED: the socket is destroyed and the hook rejects, and the
// caller gets a prompt, attributable checkout error inside its own budget.
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
          await applySetupSql(client, setupSql, settings.pool.connectionTimeoutMillis);
        } catch (err) {
          if (err instanceof StalledSetupError) {
            destroyStalledClient(client);
            log(`pg pool: connection stalled applying session timeouts (${err.budgetMs}ms); dropping it`);
            throw err;
          }
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
  statementTimeoutSql,
  createPool,
};
