import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let pool;
let client;
let query;
let userIds = [];
let schemaName;

suite('lastActivityAt against a real Postgres', () => {
  beforeAll(async () => {
    process.env.TZ = 'America/New_York';
    process.env.DATABASE_URL = TEST_URL;

    const { sql } = require('drizzle-orm');
    const { PgDialect } = require('drizzle-orm/pg-core');
    const { lastActivityAt, SERVER_TIMEZONE } = require('./lastActivity.js');
    ({ pool } = require('../db.js'));

    expect(SERVER_TIMEZONE).toBe('America/New_York');

    client = await pool.connect();
    schemaName = `last_activity_${process.pid}_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        username text NOT NULL UNIQUE
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS problem_attempts (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        node_id integer NOT NULL,
        operand_a integer NOT NULL,
        operand_b integer NOT NULL,
        operator text NOT NULL,
        answer integer NOT NULL,
        outcome text NOT NULL,
        time_ms integer,
        created_at timestamptz DEFAULT now()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS play_minutes (
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        minute text NOT NULL,
        PRIMARY KEY (user_id, minute)
      )`);

    const suffix = `${process.pid}-${Date.now()}`;
    const { rows } = await client.query(
      `INSERT INTO users (username)
       VALUES ($1), ($2), ($3), ($4), ($5)
       RETURNING id`,
      ['heartbeat-' + suffix, 'attempt-' + suffix, 'heartbeat-newer-' + suffix,
        'attempt-newer-' + suffix, 'inactive-' + suffix],
    );
    userIds = rows.map(row => row.id);

    await client.query(
      `INSERT INTO play_minutes (user_id, minute) VALUES
         ($1, '2026-01-15 12:34'),
         ($2, '2026-01-15 13:00'),
         ($3, '2026-01-15 11:00')`,
      [userIds[0], userIds[2], userIds[3]],
    );
    await client.query(
      `INSERT INTO problem_attempts
         (user_id, node_id, operand_a, operand_b, operator, answer, outcome, created_at)
       VALUES
         ($1, 1, 2, 3, '+', 5, 'child', '2026-01-15T16:00:00Z'),
         ($2, 1, 2, 3, '+', 5, 'child', '2026-01-15T16:30:00Z'),
         ($3, 1, 2, 3, '+', 5, 'child', '2026-01-15T18:30:00Z')`,
      [userIds[1], userIds[2], userIds[3]],
    );

    query = new PgDialect().sqlToQuery(sql`
      SELECT u.id, ${lastActivityAt(sql.raw('u.id'))} AS last_attempt_at
      FROM users u
      WHERE u.id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      ORDER BY u.id
    `);
  });

  afterAll(async () => {
    if (pool) {
      if (client) {
        if (schemaName) await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        client.release();
      }
      await pool.end();
    }
  });

  it('returns the newest attempt or server-local heartbeat', async () => {
    const { rows } = await client.query(query.sql, query.params);
    const activity = new Map(rows.map(row => [row.id, row.last_attempt_at?.toISOString() ?? null]));

    expect(activity.get(userIds[0])).toBe('2026-01-15T17:34:00.000Z');
    expect(activity.get(userIds[1])).toBe('2026-01-15T16:00:00.000Z');
    expect(activity.get(userIds[2])).toBe('2026-01-15T18:00:00.000Z');
    expect(activity.get(userIds[3])).toBe('2026-01-15T18:30:00.000Z');
    expect(activity.get(userIds[4])).toBeNull();
  });
});
