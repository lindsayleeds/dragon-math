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

const db = drizzle(pool, { schema });

module.exports = { db, pool, schema };
