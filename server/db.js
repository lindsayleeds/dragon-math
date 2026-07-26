// Drizzle entrypoint for Dragon Math's Supabase Postgres database.
//
// Replaces the prior better-sqlite3 setup. Connection goes through the
// Supabase Session pooler (DATABASE_URL in .env), which supports prepared
// statements — required by Drizzle's pg driver.

require('dotenv').config();

const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('./db/schema');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env (see .env.example).');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
pool.on('error', (err) => {
  const code = err && err.code ? ` [${err.code}]` : '';
  const message = (err && err.message) || 'unknown error';
  console.error(`pg pool: idle client error${code}: ${message}`);
});

const db = drizzle(pool, { schema });

module.exports = { db, pool, schema };
