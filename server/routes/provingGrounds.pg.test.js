// Real-Postgres cover for the Proving Grounds medal queries. The pure rules are
// in ../lib/provingGroundsRuns.test.js; this file proves the parts that only
// Postgres can answer — that the best-per-level rollup ranks medals correctly,
// that the recent list comes back newest-first, and that the check constraints
// refuse a run the validator would also have refused.
//
// Opt-in, because there is no database in the default test environment:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/dragon_math_test npm test
//
// It TRUNCATES the tables it owns, so point it at a scratch database. It creates
// them itself (matching server/db/schema.js), so `drizzle-kit push` need not
// have run first.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let pool;
let bestMedalsFor;
let recentMedalsFor;
let isPersonalBest;
let childId;
let otherChildId;

// Insert a medal at a fixed instant so ordering assertions don't race.
async function seed(userId, mode, digit, medal, { minutesAgo = 0, elapsedMs = 40000, wrong = 0 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO proving_grounds_runs (user_id, mode, digit, medal, elapsed_ms, wrong_count, earned_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval)
     RETURNING id`,
    [userId, mode, digit, medal, elapsedMs, wrong, String(minutesAgo)],
  );
  return rows[0].id;
}

suite('proving grounds medals against a real Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    // provingGrounds.js pulls in ../middleware/auth, which refuses to load without
    // a signing secret — there is deliberately no default (see the auth-boundaries
    // note in AGENTS.md). Nothing here mints or verifies a token; this is the same
    // kind of placeholder as DATABASE_URL above.
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-signing-secret-not-used-to-verify-anything';
    ({ pool } = require('../db.js'));
    ({ bestMedalsFor, recentMedalsFor, isPersonalBest } = require('./provingGrounds.js'));

    // Minimal users table — only the columns the FK and these tests need.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        username text NOT NULL UNIQUE
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proving_grounds_runs (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode text NOT NULL,
        digit integer NOT NULL,
        medal text NOT NULL,
        elapsed_ms integer NOT NULL,
        wrong_count integer NOT NULL DEFAULT 0,
        earned_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT proving_grounds_runs_mode_check CHECK (mode IN ('mul', 'div')),
        CONSTRAINT proving_grounds_runs_digit_check CHECK (digit BETWEEN 2 AND 9),
        CONSTRAINT proving_grounds_runs_medal_check CHECK (medal IN ('bronze', 'silver', 'gold'))
      )`);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_proving_runs_user_earned ON proving_grounds_runs (user_id, earned_at)');
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DROP TABLE IF EXISTS proving_grounds_runs');
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE proving_grounds_runs, users RESTART IDENTITY CASCADE');
    const { rows } = await pool.query(
      `INSERT INTO users (username) VALUES ('medalkid'), ('otherkid') RETURNING id`);
    childId = rows[0].id;
    otherChildId = rows[1].id;
  });

  describe('bestMedalsFor', () => {
    it('returns nothing for a child with no medals', async () => {
      expect(await bestMedalsFor(childId)).toEqual({});
    });

    it('keeps the best medal per level, not the latest', async () => {
      await seed(childId, 'mul', 7, 'gold',   { minutesAgo: 60 });
      await seed(childId, 'mul', 7, 'bronze', { minutesAgo: 1 }); // a later, worse run
      await seed(childId, 'div', 3, 'silver', { minutesAgo: 30 });
      expect(await bestMedalsFor(childId)).toEqual({ 'mul-7': 'gold', 'div-3': 'silver' });
    });

    it('ranks silver above bronze and gold above silver', async () => {
      await seed(childId, 'mul', 2, 'bronze');
      await seed(childId, 'mul', 2, 'silver');
      expect((await bestMedalsFor(childId))['mul-2']).toBe('silver');
      await seed(childId, 'mul', 2, 'gold');
      expect((await bestMedalsFor(childId))['mul-2']).toBe('gold');
    });

    it('never leaks another child\'s medals', async () => {
      await seed(otherChildId, 'mul', 9, 'gold');
      expect(await bestMedalsFor(childId)).toEqual({});
    });
  });

  describe('recentMedalsFor', () => {
    it('returns medals newest first', async () => {
      await seed(childId, 'mul', 2, 'bronze', { minutesAgo: 90 });
      await seed(childId, 'div', 5, 'gold',   { minutesAgo: 5 });
      await seed(childId, 'mul', 8, 'silver', { minutesAgo: 45 });
      const rows = await recentMedalsFor(childId);
      expect(rows.map(r => `${r.mode}-${r.digit}`)).toEqual(['div-5', 'mul-8', 'mul-2']);
    });

    it('carries the datetime and the run detail a grown-up reads', async () => {
      await seed(childId, 'div', 6, 'silver', { elapsedMs: 52300, wrong: 1 });
      const [row] = await recentMedalsFor(childId);
      expect(row).toMatchObject({ mode: 'div', digit: 6, medal: 'silver', elapsed_ms: 52300, wrong_count: 1 });
      expect(row.earned_at).toBeInstanceOf(Date);
    });

    it('honours a limit and caps an absurd one', async () => {
      for (let i = 0; i < 5; i++) await seed(childId, 'mul', 2, 'bronze', { minutesAgo: i });
      expect(await recentMedalsFor(childId, { limit: 2 })).toHaveLength(2);
      expect(await recentMedalsFor(childId, { limit: '999999' })).toHaveLength(5);
    });

    it('scopes to one child', async () => {
      await seed(otherChildId, 'mul', 9, 'gold');
      expect(await recentMedalsFor(childId)).toEqual([]);
    });
  });

  describe('isPersonalBest', () => {
    it('is true for a first medal at a level', async () => {
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 4, medal: 'bronze' })).toBe(true);
    });

    it('is true only when the new medal beats the best prior one', async () => {
      await seed(childId, 'mul', 4, 'silver');
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 4, medal: 'gold' })).toBe(true);
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 4, medal: 'silver' })).toBe(false);
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 4, medal: 'bronze' })).toBe(false);
    });

    it('compares against the best prior medal, not the most recent', async () => {
      await seed(childId, 'mul', 4, 'gold',   { minutesAgo: 60 });
      await seed(childId, 'mul', 4, 'bronze', { minutesAgo: 1 });
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 4, medal: 'silver' })).toBe(false);
    });

    it('treats each level and mode independently', async () => {
      await seed(childId, 'mul', 4, 'gold');
      expect(await isPersonalBest(childId, { mode: 'div', digit: 4, medal: 'bronze' })).toBe(true);
      expect(await isPersonalBest(childId, { mode: 'mul', digit: 5, medal: 'bronze' })).toBe(true);
    });
  });

  // The validator refuses these first; the constraints are the backstop for any
  // future writer that skips it.
  describe('check constraints', () => {
    it.each([
      ['an unknown mode', 'add', 7, 'gold'],
      ['an out-of-range digit', 'mul', 1, 'gold'],
      ['an unknown medal', 'mul', 7, 'platinum'],
    ])('rejects %s', async (_label, mode, digit, medal) => {
      await expect(seed(childId, mode, digit, medal)).rejects.toThrow();
    });
  });
});
