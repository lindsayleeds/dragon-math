// Drizzle entrypoint for Dragon Math's Supabase Postgres database.
//
// Replaces the prior better-sqlite3 setup. Connection goes through the
// Supabase Session pooler (DATABASE_URL in .env), which supports prepared
// statements — required by Drizzle's pg driver.
//
// The pool's bounds (acquisition timeout, idle timeout, server-side statement
// timeout, keepalive) and the idle-client 'error' listener that keeps a
// Supabase failover from killing this process both live in
// server/lib/pgPool.js, which owns the reasoning and the env knobs.

require('dotenv').config();

const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('./db/schema');
const { createPool, sessionTimeoutSql } = require('./lib/pgPool');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env (see .env.example).');
}

const { pool, settings } = createPool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(pool, { schema });

// Escape hatch for work that may legitimately outrun the pool-wide statement
// timeout: operator-facing reports nobody is blocked on. `fn` gets a Drizzle
// handle bound to one checked-out client, so every query inside runs on the
// connection whose budget was raised — going through the shared `db` would put
// them on arbitrary other connections that still carry the default.
//
// The raised budget is per-connection state, so the connection must never go
// back to the pool still carrying it. On the way out the pool default is
// re-applied, and if *that* round trip fails the client is released with an
// error, which makes pg destroy the socket rather than pool a connection with a
// minute-long budget on it.
//
// Two costs to weigh before reaching for this: it pins a pool slot for the
// whole callback, and it reintroduces exactly the long-held-connection risk the
// rest of this file removes. Keep it to paths with a small, trusted, low
// concurrency audience — today that means the /admin roster reports.
const RESTORE_SQL = sessionTimeoutSql(settings.session) || 'SET statement_timeout = 0';
const LONG_BUDGET_SQL = `SET statement_timeout = ${settings.session.longStatementTimeoutMs}`;

async function withLongQueryBudget(fn) {
  const client = await pool.connect();
  try {
    await client.query(LONG_BUDGET_SQL);
    return await fn(drizzle(client, { schema }));
  } finally {
    let restoreErr;
    try {
      await client.query(RESTORE_SQL);
    } catch (err) {
      restoreErr = err instanceof Error ? err : new Error('failed to restore statement_timeout');
    }
    client.release(restoreErr);
  }
}

module.exports = { db, pool, schema, settings, withLongQueryBudget };
