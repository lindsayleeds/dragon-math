// Plausibility flags end to end, against a real Postgres, over HTTP (ADR 0004,
// docs/PLAUSIBILITY.md). Two kids share a classroom, a school and a tribe: one
// plays plausibly, the other uploads results no real game produces. What this
// pins is both halves of the rule —
//   - every shared view (classroom and tribe rankings, a classmate's den, the
//     teacher's roster and playtime stats, the school's student list, the
//     Munchers leaderboard) leaves the flagged results out, and
//   - the flagged kid keeps everything: their own dragons, map progress, and the
//     stats their grown-ups read (buildAnalytics) are exactly as if unflagged.
// The pure checks themselves are in server/lib/plausibility.test.js.
//
// Opt-in, like the other *.pg.test.js files:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/dragon_math_test npm test
//
// Built the same way as sync.pg.test.js: the tables live in a schema of this
// file's own (search_path), the DDL restates server/db/schema.js for what these
// routes touch, and a check against schema.js's column lists fails the suite if
// the two drift apart.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const Module = require('module');

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let admin;
let schemaName;
let server;
let baseUrl;
let pool;
let originalLoad;
let signToken;
let buildAnalytics;
let PLAUSIBILITY;
let honest, cheat, teacher;
let classroomId, schoolId, tribeId;

const q = async (text, params) => (await admin.query(text, params)).rows;

const DDL = [
  `CREATE TABLE users (
    id serial PRIMARY KEY,
    username text NOT NULL UNIQUE,
    current_node_id integer NOT NULL DEFAULT 1,
    avatar text NOT NULL DEFAULT 'x',
    account_type text NOT NULL DEFAULT 'child',
    adult_role text NOT NULL DEFAULT 'parent',
    email text,
    real_name text,
    needs_handle boolean NOT NULL DEFAULT false,
    login_token text,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE parent_child_links (
    parent_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (parent_id, child_id)
  )`,
  `CREATE TABLE problem_attempts (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    node_id integer NOT NULL,
    operand_a integer NOT NULL,
    operand_b integer NOT NULL,
    operator text NOT NULL,
    answer integer NOT NULL,
    outcome text NOT NULL,
    time_ms integer,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE wrong_taps (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    node_id integer NOT NULL,
    operand_a integer NOT NULL,
    operand_b integer NOT NULL,
    operator text NOT NULL,
    correct_answer integer NOT NULL,
    tapped_value integer NOT NULL,
    time_ms integer,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE matches (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    node_id integer NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    outcome text,
    player_score integer NOT NULL DEFAULT 0,
    ai_score integer NOT NULL DEFAULT 0,
    opponent_user_id integer REFERENCES users(id),
    match_kind text NOT NULL DEFAULT 'ai',
    pvp_match_uid text,
    client_match_id uuid
  )`,
  'CREATE UNIQUE INDEX matches_client_match_id_unique ON matches (client_match_id)',
  `CREATE TABLE node_progress (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    node_id integer NOT NULL,
    completed boolean NOT NULL DEFAULT false,
    stars integer,
    completed_at timestamptz
  )`,
  'CREATE UNIQUE INDEX node_progress_user_node_unique ON node_progress (user_id, node_id)',
  `CREATE TABLE dragon_catalog (
    dragon_id integer PRIMARY KEY,
    name text,
    rarity text NOT NULL DEFAULT 'common',
    retired boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE user_dragons (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dragon_id integer NOT NULL,
    count integer NOT NULL DEFAULT 1,
    flagged_count integer NOT NULL DEFAULT 0,
    first_acquired_at timestamptz DEFAULT now()
  )`,
  'CREATE UNIQUE INDEX user_dragons_user_dragon_unique ON user_dragons (user_id, dragon_id)',
  `CREATE TABLE play_minutes (
    user_id integer NOT NULL REFERENCES users(id),
    minute text NOT NULL,
    flagged boolean NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, minute)
  )`,
  `CREATE TABLE sync_events (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_by integer REFERENCES users(id) ON DELETE SET NULL,
    kind text NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    applied boolean NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE plausibility_flags (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject text NOT NULL,
    subject_ref text NOT NULL,
    sync_event_id uuid REFERENCES sync_events(id) ON DELETE SET NULL,
    reasons text[] NOT NULL,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE UNIQUE INDEX plausibility_flags_subject_unique ON plausibility_flags (subject, subject_ref)',
  `CREATE TABLE game_scores (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game text NOT NULL,
    score integer NOT NULL DEFAULT 0,
    flagged boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE classrooms (
    id serial PRIMARY KEY,
    teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    join_code text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE classroom_members (
    classroom_id integer NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    child_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (classroom_id, child_id)
  )`,
  `CREATE TABLE schools (
    id serial PRIMARY KEY,
    name text NOT NULL,
    join_code text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE school_admins (
    school_id integer NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (school_id, user_id)
  )`,
  `CREATE TABLE school_teachers (
    school_id integer NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (school_id, user_id)
  )`,
  `CREATE TABLE tribes (
    id serial PRIMARY KEY,
    owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    join_code text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
  )`,
  `CREATE TABLE tribe_members (
    tribe_id integer NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
    child_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (tribe_id, child_id)
  )`,
  `CREATE TABLE dragon_trial_results (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    taken_at timestamptz NOT NULL DEFAULT now(),
    target_node_id integer NOT NULL,
    highest_op text,
    add_score integer NOT NULL DEFAULT 0, add_band text NOT NULL DEFAULT 'not_ready', add_asked integer NOT NULL DEFAULT 0,
    sub_score integer NOT NULL DEFAULT 0, sub_band text NOT NULL DEFAULT 'not_ready', sub_asked integer NOT NULL DEFAULT 0,
    mul_score integer NOT NULL DEFAULT 0, mul_band text NOT NULL DEFAULT 'not_ready', mul_asked integer NOT NULL DEFAULT 0,
    div_score integer NOT NULL DEFAULT 0, div_band text NOT NULL DEFAULT 'not_ready', div_asked integer NOT NULL DEFAULT 0
  )`,
];

// Every column schema.js declares for these tables exists here (users is a
// deliberate subset: only what the routes read or write).
async function expectColumnsMatchSchema() {
  const { getTableConfig } = require('drizzle-orm/pg-core');
  const schema = require('../db/schema.js');
  const tables = ['parentChildLinks', 'problemAttempts', 'wrongTaps', 'matches', 'nodeProgress', 'dragonCatalog',
    'userDragons', 'playMinutes', 'syncEvents', 'plausibilityFlags', 'gameScores', 'classrooms', 'classroomMembers',
    'schools', 'schoolAdmins', 'schoolTeachers', 'tribes', 'tribeMembers', 'dragonTrialResults'];
  for (const key of tables) {
    const { name, columns } = getTableConfig(schema[key]);
    const rows = await q(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [schemaName, name],
    );
    expect(rows.map(r => r.column_name).sort(), name).toEqual(columns.map(c => c.name).sort());
  }
}

const kidToken = id => signToken({ id, username: `kid${id}`, account_type: 'child' });
const teacherToken = () => signToken({ id: teacher, username: 'teach', account_type: 'parent', adult_role: 'teacher' });

async function call(method, path, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${as}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Two days ago: inside the week every view below reports, well inside the
// accepted offline age.
const BASE = Date.now() - 2 * DAY;
const at = ms => new Date(BASE + ms).toISOString();
const ev = (child, kind, payload, ms) => ({ id: randomUUID(), child_id: child, kind, occurred_at: at(ms), payload });

async function sync(child, events) {
  const { results } = await call('POST', '/api/sync/events', { as: kidToken(child), body: { events } });
  return results.map(r => r.status);
}

const matchEvents = (child, { startMs, endMs, playerScore, aiScore }) => {
  const matchId = randomUUID();
  return {
    matchId,
    started: ev(child, 'match_started', { match_id: matchId, node_id: 3 }, startMs),
    ended: ev(child, 'match_ended', { match_id: matchId, node_id: 3, outcome: 'child', player_score: playerScore, ai_score: aiScore }, endMs),
  };
};

const flags = () => q('SELECT user_id, subject, subject_ref, reasons FROM plausibility_flags ORDER BY id');
const byId = (rows, id) => rows.find(r => r.id === id);

suite('plausibility flags against a real Postgres', () => {
  beforeAll(async () => {
    const { Client } = require('pg');

    schemaName = `plausibility_${process.pid}_${Date.now()}`;
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}", public`);

    for (const stmt of DDL) await admin.query(stmt);
    await expectColumnsMatchSchema();

    const url = new URL(TEST_URL);
    url.searchParams.set('options', `-c search_path=${schemaName},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'plausibility-pg-test-secret';

    originalLoad = Module._load;
    Module._load = function patched(request, parent, isMain) {
      if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: true, remaining: 1 }) };
      return originalLoad.call(this, request, parent, isMain);
    };

    ({ pool } = require('../db.js'));
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth.js');
    signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
    ({ buildAnalytics } = require('../lib/analytics.js'));
    ({ PLAUSIBILITY } = require('../lib/plausibility.js'));

    // Munchers is a paid game; the plan resolver has its own suites. The route
    // destructures these at load, so they are replaced before it is required.
    const entitlements = require('../lib/entitlements.js');
    entitlements.effectivePlanForUser = async () => 'premium';
    entitlements.isGameLocked = () => false;

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/sync', require('./sync.js'));
    app.use('/api/dragons', require('./dragons.js'));
    app.use('/api/progress', require('./progress.js'));
    app.use('/api/playtime', require('./playtime.js'));
    app.use('/api/classroom', require('./classroom.js'));
    app.use('/api/school', require('./school.js').router);
    app.use('/api/tribes', require('./tribes.js'));
    app.use('/api/leaderboard', require('./leaderboard.js'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 60_000);

  afterAll(async () => {
    if (originalLoad) Module._load = originalLoad;
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE plausibility_flags, sync_events, problem_attempts, wrong_taps, matches, node_progress,
      user_dragons, dragon_catalog, play_minutes, game_scores, classroom_members, classrooms, school_admins,
      school_teachers, schools, tribe_members, tribes, dragon_trial_results, parent_child_links, users
      RESTART IDENTITY CASCADE`);
    const users = await q(`INSERT INTO users (username, account_type, adult_role) VALUES
      ('honest', 'child', 'parent'), ('cheat', 'child', 'parent'), ('teach', 'parent', 'teacher') RETURNING id`);
    [honest, cheat, teacher] = users.map(u => u.id);
    await q(`INSERT INTO dragon_catalog (dragon_id, name)
      SELECT n, 'Dragon ' || n FROM generate_series(1, 20) AS n`);

    [{ id: classroomId }] = await q(`INSERT INTO classrooms (teacher_id, name, join_code) VALUES ($1, 'Room 4', 'ROOM4') RETURNING id`, [teacher]);
    await q('INSERT INTO classroom_members (classroom_id, child_id) VALUES ($1, $2), ($1, $3)', [classroomId, honest, cheat]);
    [{ id: schoolId }] = await q(`INSERT INTO schools (name, join_code) VALUES ('Oak School', 'OAK') RETURNING id`);
    await q('INSERT INTO school_teachers (school_id, user_id) VALUES ($1, $2)', [schoolId, teacher]);
    await q('INSERT INTO school_admins (school_id, user_id) VALUES ($1, $2)', [schoolId, teacher]);
    [{ id: tribeId }] = await q(`INSERT INTO tribes (owner_id, name, join_code) VALUES ($1, 'Mossbacks', 'MOSS') RETURNING id`, [honest]);
    await q('INSERT INTO tribe_members (tribe_id, child_id) VALUES ($1, $2), ($1, $3)', [tribeId, honest, cheat]);
  });

  // The shared scenario: the honest kid catches two dragons and plays three
  // minutes; the cheat catches one dragon plausibly, then uploads thirteen more
  // in one event (more than any game awards) and ten minutes stamped a day in
  // the future. Unflagged, the cheat would lead with 14 dragons to 2.
  async function playBoth() {
    expect(await sync(honest, [
      ev(honest, 'dragons_collected', { dragon_ids: [1] }, 0),
      ev(honest, 'dragons_collected', { dragon_ids: [3] }, 10 * 60 * 1000),
      ev(honest, 'playtime', { minutes: 3 }, 0),
    ])).toEqual(['applied', 'applied', 'applied']);

    expect(await sync(cheat, [
      ev(cheat, 'dragons_collected', { dragon_ids: [1] }, 0),
      ev(cheat, 'dragons_collected', { dragon_ids: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] }, 60 * 1000),
      ev(cheat, 'playtime', { minutes: 1 }, 0),
      { ...ev(cheat, 'playtime', { minutes: 10 }, 0), occurred_at: new Date(Date.now() + DAY).toISOString() },
    ])).toEqual(['applied', 'applied', 'applied', 'applied']);
  }

  describe('synced results', () => {
    it('flags the implausible ones with reason codes and applies every one', async () => {
      await playBoth();

      expect((await flags()).map(f => [f.user_id, f.subject, f.reasons])).toEqual([
        [cheat, 'dragons', ['dragon_burst']],
        [cheat, 'playtime', ['clock_ahead']],
      ]);
      expect(await q('SELECT dragon_id, count, flagged_count FROM user_dragons WHERE user_id = $1 ORDER BY dragon_id', [cheat]))
        .toHaveLength(14);
      expect(await q('SELECT count(*)::int AS n FROM play_minutes WHERE user_id = $1 AND flagged', [cheat])).toEqual([{ n: 10 }]);
      expect(await q('SELECT count(*)::int AS n FROM play_minutes WHERE flagged AND user_id = $1', [honest])).toEqual([{ n: 0 }]);
    }, 20_000); // the first requests warm the pool

    it('judges a match on its duration, whichever end arrives first', async () => {
      const fair = matchEvents(honest, { startMs: 0, endMs: 90_000, playerScore: 10, aiScore: 6 });
      const fast = matchEvents(cheat, { startMs: 0, endMs: 2_000, playerScore: 10, aiScore: 0 });
      const fastReversed = matchEvents(cheat, { startMs: 0, endMs: 2_000, playerScore: 10, aiScore: 0 });

      await sync(honest, [fair.started, fair.ended]);
      await sync(cheat, [fast.started, fast.ended]);
      await sync(cheat, [fastReversed.ended]);
      // Until the start arrives, the end's stand-in start isn't judged.
      expect((await flags()).map(f => f.subject_ref)).toEqual([fast.matchId]);
      await sync(cheat, [fastReversed.started]);

      expect((await flags()).map(f => [f.subject, f.subject_ref, f.reasons])).toEqual([
        ['match', fast.matchId, ['match_too_fast']],
        ['match', fastReversed.matchId, ['match_too_fast']],
      ]);
      // Resending changes nothing.
      await sync(cheat, [fast.started, fast.ended]);
      expect(await flags()).toHaveLength(2);
      // Both matches are on the cheat's record as won.
      expect(await q("SELECT count(*)::int AS n FROM matches WHERE user_id = $1 AND outcome = 'child'", [cheat])).toEqual([{ n: 2 }]);
    });

    it('flags node wins at an impossible rate, and the map still moves', async () => {
      const count = PLAUSIBILITY.MAX_NODE_WINS_PER_WINDOW + 1;
      const wins = Array.from({ length: count }, (_, i) => ev(cheat, 'node_won', { node_id: i + 1, stars: 3 }, i * 30_000));
      await sync(cheat, wins);

      const flagged = await flags();
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged.every(f => f.subject === 'node_win' && f.reasons.includes('node_win_rate'))).toBe(true);
      const progress = await call('GET', '/api/progress', { as: kidToken(cheat) });
      expect(progress.current_node_id).toBe(count + 1);
    }, 20_000); // 61 events, each its own transaction

    it('lets a plausible record of a minute clear the flag on it', async () => {
      // Stamped a day ahead, so recorded at the current minute — which a web
      // heartbeat then also records.
      await sync(cheat, [{ ...ev(cheat, 'playtime', { minutes: 1 }, 0), occurred_at: new Date(Date.now() + DAY).toISOString() }]);
      await call('POST', '/api/playtime/heartbeat', { as: kidToken(cheat), body: {} });
      const rows = await q('SELECT flagged FROM play_minutes WHERE user_id = $1', [cheat]);
      // One row, unflagged — two if the minute turned between the calls, and
      // then the heartbeat's is the unflagged one.
      expect(rows.some(r => !r.flagged)).toBe(true);
    });
  });

  describe('shared views leave flagged results out', () => {
    it('ranks the classroom and the tribe on counted dragons', async () => {
      await playBoth();

      for (const [path, key] of [['/api/classroom/me', 'classrooms'], ['/api/tribes/me', 'tribes']]) {
        const body = await call('GET', path, { as: kidToken(honest) });
        const roster = body[key][0][key === 'classrooms' ? 'classmates' : 'members'];
        expect(byId(roster, honest), path).toMatchObject({ dragons_collected: 2, rank: 1 });
        expect(byId(roster, cheat), path).toMatchObject({ dragons_collected: 1, rank: 2 });
      }
    });

    it('shows a classmate or tribemate only their counted dragons, but a kid all of their own', async () => {
      await playBoth();

      const classmate = await call('GET', `/api/classroom/classmate/${cheat}`, { as: kidToken(honest) });
      expect(classmate.owned.map(d => d.dragon_id)).toEqual([1]);
      expect(classmate.student).toMatchObject({ dragons_collected: 1, rank: 2 });
      const tribemate = await call('GET', `/api/tribes/tribemate/${cheat}`, { as: kidToken(honest) });
      expect(tribemate.owned.map(d => d.dragon_id)).toEqual([1]);

      const self = await call('GET', `/api/classroom/classmate/${cheat}`, { as: kidToken(cheat) });
      expect(self.owned).toHaveLength(14);
      const selfTribe = await call('GET', `/api/tribes/tribemate/${cheat}`, { as: kidToken(cheat) });
      expect(selfTribe.owned).toHaveLength(14);
    });

    it('keeps flagged dragons and minutes out of the teacher and school stats', async () => {
      await playBoth();

      const detail = await call('GET', `/api/classroom/${classroomId}`, { as: teacherToken() });
      expect(byId(detail.students, honest).dragons_collected).toBe(2);
      expect(byId(detail.students, cheat).dragons_collected).toBe(1);

      const stats = await call('GET', `/api/classroom/${classroomId}/stats`, { as: teacherToken() });
      expect(byId(stats.students, honest)).toMatchObject({ week_minutes: 3, year_minutes: 3 });
      expect(byId(stats.students, cheat)).toMatchObject({ week_minutes: 1, year_minutes: 1 });

      const { students } = await call('GET', `/api/school/${schoolId}/students`, { as: teacherToken() });
      expect(byId(students, honest)).toMatchObject({ dragons_collected: 2, week_minutes: 3 });
      expect(byId(students, cheat)).toMatchObject({ dragons_collected: 1, week_minutes: 1 });
      // Last seen is the last counted minute — two days ago, not the
      // future-stamped ones recorded at now.
      const { localMinuteNow } = require('../lib/localTime.js');
      expect(byId(students, cheat).last_seen).toBe(localMinuteNow(new Date(BASE)));
      expect(byId(stats.students, cheat).last_seen).toBe(localMinuteNow(new Date(BASE)));
    });

    it('keeps an impossible Munchers score off the leaderboard', async () => {
      await call('POST', '/api/leaderboard/dragon-munchers', { as: kidToken(honest), body: { score: 310 } });
      await call('POST', '/api/leaderboard/dragon-munchers', { as: kidToken(cheat), body: { score: 99_999 } });
      await call('POST', '/api/leaderboard/dragon-munchers', { as: kidToken(cheat), body: { score: 120 } });

      const { leaderboard } = await call('GET', '/api/leaderboard/dragon-munchers', { as: kidToken(honest) });
      expect(leaderboard.map(r => [r.username, r.score])).toEqual([['honest', 310], ['cheat', 120]]);

      // Kept, flagged, with its reason.
      expect(await q('SELECT score, flagged FROM game_scores WHERE user_id = $1 ORDER BY score', [cheat]))
        .toEqual([{ score: 120, flagged: false }, { score: 99_999, flagged: true }]);
      expect((await flags()).map(f => [f.user_id, f.subject, f.reasons])).toEqual([[cheat, 'game_score', ['score_above_max']]]);
    });
  });

  describe('the flagged kid keeps everything', () => {
    it('has every dragon in their own collection, at full count', async () => {
      await playBoth();
      const { owned } = await call('GET', '/api/dragons', { as: kidToken(cheat) });
      expect(owned).toHaveLength(14);
      expect(owned.every(d => d.count === 1)).toBe(true);
    });

    it('counts flagged minutes and matches in the stats their grown-ups read', async () => {
      await playBoth();
      const fast = matchEvents(cheat, { startMs: 0, endMs: 2_000, playerScore: 10, aiScore: 0 });
      await sync(cheat, [fast.started, fast.ended]);
      expect((await flags()).some(f => f.subject === 'match')).toBe(true);

      const stats = await buildAnalytics(cheat, { days: 7 });
      // The one plausible minute plus the flagged ones (as many of the ten as
      // fall on or before today — they were recorded from now).
      expect(stats.playtime.minutes_in_window).toBeGreaterThan(1);
      expect(stats.matches).toMatchObject({ total: 1, child_wins: 1 });
    });
  });
});
