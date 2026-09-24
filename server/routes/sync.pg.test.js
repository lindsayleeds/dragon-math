// POST /api/sync/events against a real Postgres, over HTTP. What only a real
// database can answer is the whole point of this route — that a resent batch
// changes nothing, that events landing out of order reach the same end state,
// and that one event failing rolls back alone — so none of it is faked. The
// read half, GET /api/sync/progress, is here too: it is how the two-device
// tests (one child on an iPhone and an iPad) compare end states. The web
// routes that now share the same write helpers (server/lib/playRecords.js) are
// driven here too, to pin that the refactor kept their behaviour. So is the
// iOS parent view's per-child summary, which must count synced offline play.
//
// Opt-in, because there is no database in the default test environment:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/dragon_math_test npm test
//
// Isolated from other suites sharing the scratch database: the tables are built
// in a schema of this file's own, every pooled connection is pointed at it with
// a search_path startup option, and it is dropped at the end. The DDL below
// restates server/db/schema.js for the tables these routes touch — with the
// unique indexes ON CONFLICT relies on and the check constraints that can
// refuse a row — and a check against schema.js's own column lists fails the
// suite if the two drift apart.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const Module = require('module');

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let admin;          // a pg Client of the test's own, for setup and assertions
let schemaName;
let server;
let baseUrl;
let pool;
let originalLoad;
let signToken;
let expectContract;
let kid, otherKid, parent;

const q = async (text, params) => (await admin.query(text, params)).rows;

const DDL = [
  `CREATE TABLE users (
    id serial PRIMARY KEY,
    username text NOT NULL UNIQUE,
    current_node_id integer NOT NULL DEFAULT 1,
    account_type text NOT NULL DEFAULT 'child',
    telemetry_opt_out boolean NOT NULL DEFAULT false,
    avatar text NOT NULL DEFAULT '🐉'
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
    outcome text NOT NULL CONSTRAINT problem_attempts_outcome_check CHECK (outcome IN ('child', 'ai')),
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
    outcome text CONSTRAINT matches_outcome_check CHECK (outcome IN ('child', 'ai', 'incomplete')),
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
  `CREATE TABLE proving_grounds_runs (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode text NOT NULL CONSTRAINT proving_grounds_runs_mode_check CHECK (mode IN ('mul', 'div')),
    digit integer NOT NULL CONSTRAINT proving_grounds_runs_digit_check CHECK (digit BETWEEN 2 AND 9),
    medal text NOT NULL CONSTRAINT proving_grounds_runs_medal_check CHECK (medal IN ('bronze', 'silver', 'gold')),
    elapsed_ms integer NOT NULL,
    wrong_count integer NOT NULL DEFAULT 0,
    earned_at timestamptz NOT NULL DEFAULT now()
  )`,
];

// Every column schema.js declares for these tables exists here (users is a
// deliberate subset: only what the routes read or write).
async function expectColumnsMatchSchema() {
  const { getTableConfig } = require('drizzle-orm/pg-core');
  const schema = require('../db/schema.js');
  const tables = ['parentChildLinks', 'problemAttempts', 'wrongTaps', 'matches', 'nodeProgress',
    'dragonCatalog', 'userDragons', 'playMinutes', 'syncEvents', 'plausibilityFlags', 'provingGroundsRuns'];
  for (const key of tables) {
    const { name, columns } = getTableConfig(schema[key]);
    const rows = await q(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [schemaName, name],
    );
    expect(rows.map(r => r.column_name).sort(), name).toEqual(columns.map(c => c.name).sort());
  }
}

function token(id, accountType) {
  return signToken({ id, username: `user${id}`, account_type: accountType });
}

async function call(method, path, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${as}`;
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

// Posts a batch and checks the response against the contract.
async function sync(events, as = token(kid, 'child')) {
  const res = await call('POST', '/api/sync/events', { as, body: { events } });
  const body = await expectContract(res, 'post', '/api/sync/events');
  return { status: res.status, body, statuses: body.results?.map(r => r.status) };
}

let clock = Date.now() - 10 * 24 * 60 * 60 * 1000;
function ev(kind, payload, overrides = {}) {
  clock += 1000;
  return { id: randomUUID(), child_id: kid, kind, occurred_at: new Date(clock).toISOString(), payload, ...overrides };
}

const attempt = (over = {}) => ({
  node_id: 4, operand_a: 3, operand_b: 4, operator: 'mul', answer: 12, outcome: 'child', time_ms: 2100, ...over,
});

async function count(table, where = 'true', params = []) {
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return n;
}

suite('POST /api/sync/events against a real Postgres', () => {
  beforeAll(async () => {
    const { Client } = require('pg');

    schemaName = `sync_events_${process.pid}_${Date.now()}`;
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}", public`);

    for (const stmt of DDL) await admin.query(stmt);
    await expectColumnsMatchSchema();

    const url = new URL(TEST_URL);
    url.searchParams.set('options', `-c search_path=${schemaName},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'sync-pg-test-secret';

    // The limiter has its own real-Postgres suite; here it would only count.
    originalLoad = Module._load;
    Module._load = function patched(request, parent, isMain) {
      if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: true, remaining: 1 }) };
      return originalLoad.call(this, request, parent, isMain);
    };

    ({ pool } = require('../db.js'));
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth.js');
    signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
    ({ expectContract } = require('../contracts/testing.js'));

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/sync', require('./sync.js'));
    app.use('/api/attempts', require('./attempts.js'));
    app.use('/api/matches', require('./matches.js'));
    app.use('/api/progress', require('./progress.js'));
    app.use('/api/dragons', require('./dragons.js'));
    app.use('/api/playtime', require('./playtime.js'));
    app.use('/api/proving-grounds', require('./provingGrounds.js').router);
    app.use('/api/parent', require('./parent.js'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 60_000); // requires the whole route stack; slow on a loaded runner

  afterAll(async () => {
    if (originalLoad) Module._load = originalLoad;
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(() => resetDb());

  async function resetDb() {
    await admin.query(`TRUNCATE proving_grounds_runs, plausibility_flags, sync_events, problem_attempts, wrong_taps, matches, node_progress,
      user_dragons, dragon_catalog, play_minutes, parent_child_links, users RESTART IDENTITY CASCADE`);
    const users = await q(`INSERT INTO users (username, account_type) VALUES
      ('sparky', 'child'), ('ember', 'child'), ('grownup', 'parent') RETURNING id`);
    [kid, otherKid, parent] = users.map(u => u.id);
    await q('INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $2)', [parent, kid]);
    await q(`INSERT INTO dragon_catalog (dragon_id, name, retired) VALUES
      (1, 'Mossy', false), (2, 'Pebble', false), (3, 'Old Flame', true)`);
  }

  describe('applying events', () => {
    it('writes each kind into the tables the web routes write', async () => {
      const matchId = randomUUID();
      const events = [
        ev('match_started', { match_id: matchId, node_id: 4 }),
        ev('attempt', attempt()),
        ev('wrong_tap', { node_id: 4, operand_a: 3, operand_b: 4, operator: 'mul', correct_answer: 12, tapped_value: 13 }),
        ev('match_ended', { match_id: matchId, node_id: 4, outcome: 'child', player_score: 9, ai_score: 4 }),
        ev('node_won', { node_id: 4, stars: 2 }),
        ev('dragons_collected', { dragon_ids: [1, 1, 2] }),
        ev('playtime', { minutes: 3 }),
      ];
      const { status, body, statuses } = await sync(events);

      expect(status).toBe(200);
      expect(statuses).toEqual(Array(7).fill('applied'));
      expect(body.results.map(r => r.id)).toEqual(events.map(e => e.id));
      expect(body.results.every(r => r.acknowledged)).toBe(true);

      const [match] = await q('SELECT * FROM matches');
      expect(match).toMatchObject({ user_id: kid, node_id: 4, outcome: 'child', player_score: 9, ai_score: 4, client_match_id: matchId });
      expect(match.started_at.toISOString()).toBe(events[0].occurred_at);
      expect(match.ended_at.toISOString()).toBe(events[3].occurred_at);

      const [row] = await q('SELECT * FROM problem_attempts');
      expect(row).toMatchObject({ user_id: kid, node_id: 4, operand_a: 3, operand_b: 4, operator: 'mul', answer: 12, outcome: 'child', time_ms: 2100 });
      // Dated when it was answered, not when it was uploaded.
      expect(row.created_at.toISOString()).toBe(events[1].occurred_at);
      expect(await count('wrong_taps', 'tapped_value = 13')).toBe(1);

      expect(await q('SELECT node_id, stars, completed FROM node_progress')).toEqual([{ node_id: 4, stars: 2, completed: true }]);
      expect((await q('SELECT current_node_id FROM users WHERE id = $1', [kid]))[0].current_node_id).toBe(5);

      expect(await q('SELECT dragon_id, count FROM user_dragons ORDER BY dragon_id')).toEqual([
        { dragon_id: 1, count: 2 }, { dragon_id: 2, count: 1 },
      ]);
      expect(await count('play_minutes', 'user_id = $1', [kid])).toBe(3);

      const stored = await q('SELECT kind, applied, user_id, submitted_by FROM sync_events ORDER BY occurred_at');
      expect(stored).toHaveLength(7);
      expect(stored.every(r => r.applied && r.user_id === kid && r.submitted_by === kid)).toBe(true);
    });

    it('records a Proving Grounds medal as the web does, dated when it was earned', async () => {
      const medal = over => ({ mode: 'mul', digit: 7, medal: 'silver', elapsed_ms: 52340, wrong_count: 0, ...over });
      const events = [
        ev('proving_medal', medal()),
        ev('proving_medal', medal({ medal: 'gold', elapsed_ms: 41000 })),
        ev('proving_medal', medal({ mode: 'div', digit: 3, medal: 'bronze', elapsed_ms: 80000, wrong_count: 1 })),
      ];
      expect((await sync(events)).statuses).toEqual(Array(3).fill('applied'));

      const rows = await q('SELECT user_id, mode, digit, medal, elapsed_ms, wrong_count, earned_at FROM proving_grounds_runs ORDER BY id');
      expect(rows.map(({ earned_at: _e, ...r }) => r)).toEqual([
        { user_id: kid, mode: 'mul', digit: 7, medal: 'silver', elapsed_ms: 52340, wrong_count: 0 },
        { user_id: kid, mode: 'mul', digit: 7, medal: 'gold', elapsed_ms: 41000, wrong_count: 0 },
        { user_id: kid, mode: 'div', digit: 3, medal: 'bronze', elapsed_ms: 80000, wrong_count: 1 },
      ]);
      expect(rows[0].earned_at.toISOString()).toBe(events[0].occurred_at);

      // What the web page and the parent dashboard read back.
      const best = await (await call('GET', '/api/proving-grounds/medals', { as: token(kid, 'child') })).json();
      expect(best).toEqual({ medals: { 'mul-7': 'gold', 'div-3': 'bronze' } });
      expect((await sync(events)).statuses).toEqual(Array(3).fill('duplicate'));
      expect(await count('proving_grounds_runs')).toBe(3);
    });

    it('accepts an upper-case UUID, as Swift writes them, and echoes it back as sent', async () => {
      const e = ev('attempt', attempt(), { id: randomUUID().toUpperCase() });
      const { body } = await sync([e]);
      expect(body.results[0]).toMatchObject({ id: e.id, status: 'applied' });
      expect((await sync([{ ...e, id: e.id.toLowerCase() }])).statuses).toEqual(['duplicate']);
    });

    it('records a future occurred_at as now, but stores what the device said', async () => {
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await sync([ev('attempt', attempt(), { occurred_at: future })]);
      const [row] = await q('SELECT created_at FROM problem_attempts');
      expect(row.created_at.getTime()).toBeLessThanOrEqual(Date.now());
      const [stored] = await q('SELECT occurred_at FROM sync_events');
      expect(stored.occurred_at.toISOString()).toBe(future);
    });

    it('awards a retired dragon the device already handed out, and skips ids the catalog never had', async () => {
      const { statuses } = await sync([
        ev('dragons_collected', { dragon_ids: [3, 999] }),
        ev('dragons_collected', { dragon_ids: [998] }),
      ]);
      expect(statuses).toEqual(['applied', 'rejected']);
      expect(await q('SELECT dragon_id, count FROM user_dragons')).toEqual([{ dragon_id: 3, count: 1 }]);
    });
  });

  describe('resending', () => {
    it('has no extra effect when the same batch is sent twice', async () => {
      const matchId = randomUUID();
      const events = [
        ev('match_started', { match_id: matchId, node_id: 2 }),
        ev('attempt', attempt()),
        ev('match_ended', { match_id: matchId, node_id: 2, outcome: 'ai', player_score: 3, ai_score: 9 }),
        ev('dragons_collected', { dragon_ids: [1] }),
        ev('node_won', { node_id: 2, stars: 1 }),
        ev('playtime', { minutes: 2 }),
        ev('telemetry.app_opened', { build: '1.0 (7)' }),
      ];
      const snapshot = async () => ({
        attempts: await count('problem_attempts'),
        matches: await q('SELECT outcome, player_score, ai_score, started_at, ended_at FROM matches'),
        dragons: await q('SELECT dragon_id, count FROM user_dragons'),
        progress: await q('SELECT node_id, stars, completed_at FROM node_progress'),
        minutes: await count('play_minutes'),
        synced: await count('sync_events'),
      });

      const first = await sync(events);
      expect(first.statuses).toEqual([...Array(6).fill('applied'), 'stored']);
      const before = await snapshot();

      const second = await sync(events);
      expect(second.statuses).toEqual(Array(7).fill('duplicate'));
      expect(second.body.results.every(r => r.acknowledged)).toBe(true);
      expect(await snapshot()).toEqual(before);
      expect(before.dragons).toEqual([{ dragon_id: 1, count: 1 }]);
    });

    it('treats a repeat inside one batch as a duplicate', async () => {
      const e = ev('dragons_collected', { dragon_ids: [2] });
      expect((await sync([e, e])).statuses).toEqual(['applied', 'duplicate']);
      expect(await q('SELECT count FROM user_dragons')).toEqual([{ count: 1 }]);
    });

    it('applies each event once when two uploads of the same batch race', async () => {
      const events = [ev('dragons_collected', { dragon_ids: [1] }), ev('attempt', attempt()), ev('attempt', attempt())];
      const [a, b] = await Promise.all([sync(events), sync(events)]);
      for (let i = 0; i < events.length; i++) {
        expect([a.statuses[i], b.statuses[i]].sort()).toEqual(['applied', 'duplicate']);
      }
      expect(await q('SELECT count FROM user_dragons')).toEqual([{ count: 1 }]);
      expect(await count('problem_attempts')).toBe(2);
    });

    it('refuses an id already used for another child instead of calling it a duplicate', async () => {
      const e = ev('attempt', attempt());
      await sync([e]);
      const { body } = await sync([{ ...e, child_id: otherKid }], token(otherKid, 'child'));
      expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'id_conflict', acknowledged: true });
      expect(await count('problem_attempts', 'user_id = $1', [otherKid])).toBe(0);
    });
  });

  describe('out of order', () => {
    it('puts a match together when its end arrives before its start', async () => {
      const matchId = randomUUID();
      const started = ev('match_started', { match_id: matchId, node_id: 6 });
      const ended = ev('match_ended', { match_id: matchId, node_id: 6, outcome: 'child', player_score: 10, ai_score: 2 });

      expect((await sync([ended])).statuses).toEqual(['applied']);
      expect((await sync([started])).statuses).toEqual(['applied']);

      const rows = await q('SELECT * FROM matches');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'child', player_score: 10, ai_score: 2 });
      expect(rows[0].started_at.toISOString()).toBe(started.occurred_at);
      expect(rows[0].ended_at.toISOString()).toBe(ended.occurred_at);
    });

    it('lets a real result replace an abandon beacon, never the reverse', async () => {
      const a = randomUUID();
      const b = randomUUID();
      const end = (matchId, outcome) => ev('match_ended', { match_id: matchId, node_id: 1, outcome, player_score: 5, ai_score: 5 });

      await sync([end(a, 'incomplete'), end(a, 'child')]);
      await sync([end(b, 'ai'), end(b, 'incomplete'), end(b, 'child')]);

      const rows = await q('SELECT client_match_id, outcome FROM matches');
      const outcome = Object.fromEntries(rows.map(r => [r.client_match_id, r.outcome]));
      expect(outcome).toEqual({ [a]: 'child', [b]: 'ai' });
    });

    it('keeps the best stars and the first completion whichever win arrives first', async () => {
      const early = ev('node_won', { node_id: 3, stars: 1 });
      const late = ev('node_won', { node_id: 3, stars: 3 });
      await sync([late]);
      await sync([early]);
      const [row] = await q('SELECT stars, completed_at FROM node_progress');
      expect(row.stars).toBe(3);
      expect(row.completed_at.toISOString()).toBe(early.occurred_at);
      expect((await q('SELECT current_node_id FROM users WHERE id = $1', [kid]))[0].current_node_id).toBe(4);
    });

    it('never moves the map frontier backwards', async () => {
      await sync([ev('node_won', { node_id: 9, stars: 3 }), ev('node_won', { node_id: 2, stars: 3 })]);
      expect((await q('SELECT current_node_id FROM users WHERE id = $1', [kid]))[0].current_node_id).toBe(10);
    });

    it('dates a dragon from its earliest catch', async () => {
      const first = ev('dragons_collected', { dragon_ids: [1] });
      const second = ev('dragons_collected', { dragon_ids: [1] });
      await sync([second]);
      await sync([first]);
      const [row] = await q('SELECT count, first_acquired_at FROM user_dragons');
      expect(row.count).toBe(2);
      expect(row.first_acquired_at.toISOString()).toBe(first.occurred_at);
    });
  });

  describe('a batch with bad events in it', () => {
    it('applies the good ones and reports each bad one with a reason', async () => {
      const good1 = ev('attempt', attempt());
      const good2 = ev('node_won', { node_id: 1, stars: 3 });
      const events = [
        good1,
        { ...ev('attempt', attempt()), id: 'not-a-uuid' },
        ev('attempt', attempt({ operator: 'pow' })),
        ev('attempt', attempt(), { child_id: otherKid }),
        { kind: 'attempt' },
        ev('telemetry.screen_viewed', { screen: 'map' }),
        ev('attempt', attempt(), { occurred_at: 'yesterday' }),
        good2,
      ];
      const { body } = await sync(events);

      expect(body.results.map(r => [r.index, r.status, r.reason ?? null])).toEqual([
        [0, 'applied', null],
        [1, 'rejected', 'invalid_event'],
        [2, 'rejected', 'invalid_payload'],
        [3, 'rejected', 'not_your_child'],
        [4, 'rejected', 'invalid_event'],
        [5, 'stored', null],
        [6, 'rejected', 'invalid_event'],
        [7, 'applied', null],
      ]);
      expect(body.results[1].message).toMatch(/^id: /);
      expect(body.results[2].message).toMatch(/^operator: /);
      expect(body.results[4].id).toBeNull();
      expect(body.results.every(r => r.acknowledged)).toBe(true);

      expect(await count('problem_attempts', 'user_id = $1', [kid])).toBe(1);
      expect(await count('problem_attempts', 'user_id = $1', [otherKid])).toBe(0);
      expect(await count('node_progress')).toBe(1);
      // Rejected events are not kept; an unknown kind is, marked unapplied.
      expect(await q('SELECT id, kind, applied FROM sync_events ORDER BY kind')).toEqual([
        { id: good1.id, kind: 'attempt', applied: true },
        { id: good2.id, kind: 'node_won', applied: true },
        { id: events[5].id, kind: 'telemetry.screen_viewed', applied: false },
      ]);
    });

    it('rolls back only the event the database refuses', async () => {
      const before = ev('attempt', attempt());
      // Fits zod's "whole number" but not a Postgres integer column.
      const tooBig = ev('attempt', attempt({ operand_a: 2 ** 31 }));
      const after = ev('dragons_collected', { dragon_ids: [2] });
      const { body } = await sync([before, tooBig, after]);

      expect(body.results.map(r => r.status)).toEqual(['applied', 'rejected', 'applied']);
      expect(body.results[1]).toMatchObject({ reason: 'invalid_data', acknowledged: true });
      expect(await count('problem_attempts')).toBe(1);
      expect(await count('user_dragons')).toBe(1);
      expect(await count('sync_events', 'id = $1', [tooBig.id])).toBe(0);
    });

    it('leaves a transient failure unacknowledged, keeps the rest, and applies it on resend', async () => {
      // Stand-in for the database going away mid-batch: any error outside the
      // data/constraint classes is transient by the route's rules.
      await admin.query(`
        CREATE FUNCTION fail_node_999() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated outage'; END $$`);
      await admin.query(`
        CREATE TRIGGER fail_node_999 BEFORE INSERT ON problem_attempts
        FOR EACH ROW WHEN (NEW.node_id = 999) EXECUTE FUNCTION fail_node_999()`);

      const ok = ev('attempt', attempt());
      const flaky = ev('attempt', attempt({ node_id: 999 }));
      const ok2 = ev('playtime', { minutes: 1 });
      const batch = [ok, flaky, ok2];
      const quiet = console.error;
      console.error = () => {};
      let first;
      try {
        first = await sync(batch);
      } finally {
        console.error = quiet;
        await admin.query('DROP TRIGGER fail_node_999 ON problem_attempts');
        await admin.query('DROP FUNCTION fail_node_999()');
      }

      expect(first.statuses).toEqual(['applied', 'failed', 'applied']);
      expect(first.body.results[1]).toMatchObject({ acknowledged: false, reason: 'server_error' });
      // Its dedupe row rolled back with it, so the resend is not a "duplicate".
      expect(await count('sync_events', 'id = $1', [flaky.id])).toBe(0);

      const resend = await sync(batch);
      expect(resend.statuses).toEqual(['duplicate', 'applied', 'duplicate']);
      expect(await count('problem_attempts')).toBe(2);
      expect(await count('play_minutes')).toBe(1);
    });
  });

  describe('who may send what', () => {
    it('lets a parent upload a linked child\'s queue, recording who sent it', async () => {
      const { statuses } = await sync([ev('attempt', attempt())], token(parent, 'parent'));
      expect(statuses).toEqual(['applied']);
      expect(await q('SELECT user_id, submitted_by FROM sync_events')).toEqual([{ user_id: kid, submitted_by: parent }]);
      expect(await count('problem_attempts', 'user_id = $1', [kid])).toBe(1);
    });

    it('refuses a parent writing for a child who is not theirs', async () => {
      const { body } = await sync([ev('attempt', attempt(), { child_id: otherKid })], token(parent, 'parent'));
      expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'not_your_child' });
      expect(await count('problem_attempts')).toBe(0);
    });

    it('refuses to end a match another child started', async () => {
      const matchId = randomUUID();
      await sync([ev('match_started', { match_id: matchId, node_id: 1 })]);
      const theirs = { match_id: matchId, node_id: 1, outcome: 'child', player_score: 99, ai_score: 0 };
      const { body } = await sync([ev('match_ended', theirs, { child_id: otherKid })], token(otherKid, 'child'));
      expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'not_your_match' });
      const [match] = await q('SELECT user_id, ended_at FROM matches');
      expect(match).toEqual({ user_id: kid, ended_at: null });
      expect(await count('sync_events', 'user_id = $1', [otherKid])).toBe(0);
    });

    it('needs a session', async () => {
      const res = await call('POST', '/api/sync/events', { body: { events: [ev('attempt', attempt())] } });
      expect(res.status).toBe(401);
      await expectContract(res, 'post', '/api/sync/events');
    });

    it.each([
      ['no events array', {}, 'events must be an array'],
      ['an empty batch', { events: [] }, 'events must not be empty'],
      ['an oversized batch', { events: Array(101).fill({}) }, 'At most 100 events per request'],
    ])('rejects %s outright', async (_label, body, error) => {
      const res = await call('POST', '/api/sync/events', { as: token(kid, 'child'), body });
      expect(res.status).toBe(400);
      expect(await expectContract(res, 'post', '/api/sync/events')).toEqual({ error });
    });
  });

  // A parent turned the kid's telemetry off (PUT /api/parent/children/:id/telemetry
  // sets the column): telemetry kinds are dropped unread, progress still applies.
  describe('a child opted out of telemetry', () => {
    const optOut = (id = kid, off = true) => q('UPDATE users SET telemetry_opt_out = $2 WHERE id = $1', [id, off]);

    it('skips telemetry without storing it and applies progress', async () => {
      await optOut();
      const matchId = randomUUID();
      const events = [
        ev('match_started', { match_id: matchId, node_id: 4 }),
        ev('attempt', attempt()),
        ev('wrong_tap', { node_id: 4, operand_a: 3, operand_b: 4, operator: 'mul', correct_answer: 12, tapped_value: 13 }),
        ev('match_ended', { match_id: matchId, node_id: 4, outcome: 'child', player_score: 9, ai_score: 4 }),
        ev('playtime', { minutes: 3 }),
        ev('telemetry.app_opened', { build: '1.0 (7)' }),
        ev('node_won', { node_id: 4, stars: 2 }),
        ev('dragons_collected', { dragon_ids: [1] }),
        ev('memorize.progress', { passage_id: 3 }),
      ];
      const { body, statuses } = await sync(events, token(parent, 'parent'));

      expect(statuses).toEqual([...Array(6).fill('skipped'), 'applied', 'applied', 'stored']);
      expect(body.results.every(r => r.acknowledged)).toBe(true);
      expect(body.results[0]).toMatchObject({ reason: 'telemetry_opt_out' });
      for (const table of ['matches', 'problem_attempts', 'wrong_taps', 'play_minutes']) {
        expect(await count(table), table).toBe(0);
      }
      expect(await q('SELECT kind FROM sync_events ORDER BY occurred_at')).toEqual([
        { kind: 'node_won' }, { kind: 'dragons_collected' }, { kind: 'memorize.progress' },
      ]);
      expect(await q('SELECT node_id, stars FROM node_progress')).toEqual([{ node_id: 4, stars: 2 }]);
      expect(await q('SELECT dragon_id, count FROM user_dragons')).toEqual([{ dragon_id: 1, count: 1 }]);
    });

    it('is per child, and reported on the progress pull', async () => {
      await optOut();
      await q('INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $2)', [parent, otherKid]);
      const { statuses } = await sync([
        ev('attempt', attempt()),
        ev('attempt', attempt(), { child_id: otherKid }),
      ], token(parent, 'parent'));
      expect(statuses).toEqual(['skipped', 'applied']);
      expect(await q('SELECT user_id FROM problem_attempts')).toEqual([{ user_id: otherKid }]);

      const pull = async id => expectContract(
        await call('GET', `/api/sync/progress?child_id=${id}`, { as: token(parent, 'parent') }),
        'get', '/api/sync/progress');
      expect((await pull(kid)).telemetry_opt_out).toBe(true);
      expect((await pull(otherKid)).telemetry_opt_out).toBe(false);
    });

    it('applies telemetry again once turned back on', async () => {
      await optOut();
      const e = ev('playtime', { minutes: 2 });
      expect((await sync([e])).statuses).toEqual(['skipped']);
      await optOut(kid, false);
      expect((await sync([e])).statuses).toEqual(['applied']);
      expect(await count('play_minutes')).toBe(2);
    });
  });

  // The web routes now write through the same helpers; these pin that they
  // still behave as they did.
  describe('web routes on the shared helpers', () => {
    const as = () => token(kid, 'child');

    it('opens and ends a match once, and refuses another player', async () => {
      const opened = await call('POST', '/api/matches', { as: as(), body: { node_id: 2 } });
      expect(opened.status).toBe(201);
      const { id } = await opened.json();

      const end = body => call('POST', `/api/matches/${id}/end`, { as: as(), body });
      expect(await (await end({ outcome: 'child', player_score: 7, ai_score: 3 })).json()).toEqual({ ok: true });
      expect(await (await end({ outcome: 'incomplete' })).json()).toEqual({ ok: true, alreadyEnded: true });
      const other = await call('POST', `/api/matches/${id}/end`, { as: token(otherKid, 'child'), body: { outcome: 'ai' } });
      expect(other.status).toBe(403);
      expect((await call('POST', '/api/matches/9999/end', { as: as(), body: { outcome: 'ai' } })).status).toBe(404);
      expect(await q('SELECT outcome, player_score, ai_score, client_match_id FROM matches')).toEqual([
        { outcome: 'child', player_score: 7, ai_score: 3, client_match_id: null },
      ]);
    });

    it('lets the latest node win overwrite stars and advances the frontier', async () => {
      await call('PUT', '/api/progress/3', { as: as(), body: { stars: 3 } });
      await call('PUT', '/api/progress/3', { as: as(), body: { stars: 1 } });
      await call('PUT', '/api/progress/1', { as: as(), body: {} });
      expect(await q('SELECT node_id, stars FROM node_progress ORDER BY node_id')).toEqual([
        { node_id: 1, stars: 3 }, { node_id: 3, stars: 1 },
      ]);
      const progress = await (await call('GET', '/api/progress', { as: as() })).json();
      expect(progress.current_node_id).toBe(4);
    });

    it('collects dragons, reporting first catches', async () => {
      const collect = ids => call('POST', '/api/dragons/collect', { as: as(), body: { dragon_ids: ids } });
      expect(await (await collect([1, 1, 3, 2])).json()).toEqual({
        ok: true,
        collected: 3,
        newly_added: [1, 2],
        results: [
          { dragon_id: 1, added: 2, total: 2, is_new: true },
          { dragon_id: 2, added: 1, total: 1, is_new: true },
        ],
      });
      expect((await (await collect([2])).json()).results).toEqual([{ dragon_id: 2, added: 1, total: 2, is_new: false }]);
      expect((await collect([3])).status).toBe(400);
    });

    it('records a medal run and reports a personal best', async () => {
      const run = body => call('POST', '/api/proving-grounds/runs', { as: as(), body });
      const first = await run({ mode: 'div', digit: 4, medal: 'silver', elapsed_ms: 55000.4, wrong_count: 0 });
      expect(first.status).toBe(201);
      expect(await first.json()).toMatchObject({ is_best: true });
      expect(await (await run({ mode: 'div', digit: 4, medal: 'bronze', elapsed_ms: 70000 })).json()).toMatchObject({ is_best: false });
      expect(await q('SELECT medal, elapsed_ms, wrong_count FROM proving_grounds_runs ORDER BY id')).toEqual([
        { medal: 'silver', elapsed_ms: 55000, wrong_count: 0 },
        { medal: 'bronze', elapsed_ms: 70000, wrong_count: 0 },
      ]);
    });

    it('logs attempts and wrong taps, and heartbeats a minute once', async () => {
      const res = await call('POST', '/api/attempts', {
        as: as(),
        body: {
          attempts: [attempt(), attempt({ outcome: 'nobody' })],
          wrongTaps: [{ node_id: 1, operand_a: 2, operand_b: 2, operator: 'add', correct_answer: 4, tapped_value: 5, time_ms: 800.6 }],
        },
      });
      expect(await res.json()).toEqual({ success: true, attempts: 2, wrongTaps: 1 });
      expect(await count('problem_attempts')).toBe(1);
      expect(await q('SELECT time_ms FROM wrong_taps')).toEqual([{ time_ms: 801 }]);

      await call('POST', '/api/playtime/heartbeat', { as: as(), body: {} });
      const beat = await (await call('POST', '/api/playtime/heartbeat', { as: as(), body: {} })).json();
      // Two beats in one minute count once (two, if the minute turned between them).
      expect(beat.today_minutes).toBe(await count('play_minutes'));
      expect([1, 2]).toContain(beat.today_minutes);
    });
  });

  // Issue #130: one child, an iPhone and an iPad, both offline for a while and
  // then online. However the two queues reach the server — either device first,
  // newest first, in scraps, resent, one through the parent's session — the end
  // state must be the one a single device playing everything would reach.
  describe('the same child on an iPhone and an iPad', () => {
    // Minute-aligned, so a playtime event's minutes are exactly the ones named.
    const base = Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 60_000) * 60_000;
    const at = minute => new Date(base + minute * 60_000).toISOString();

    // The same afternoon on both devices. They overlap: node 1 and node 2 are
    // won on each (with different stars, the better one second on node 1 and
    // first on node 2), both catch dragon 1, and minutes 5–9 are played on both.
    function devices() {
      const e = (minute, kind, payload) => ({ id: randomUUID(), child_id: kid, kind, occurred_at: at(minute), payload });
      const [m1, m2, m3] = [randomUUID(), randomUUID(), randomUUID()];
      const iphone = [
        e(0, 'playtime', { minutes: 10 }),
        e(0, 'match_started', { match_id: m1, node_id: 1 }),
        e(1, 'attempt', attempt({ node_id: 1 })),
        e(3, 'match_ended', { match_id: m1, node_id: 1, outcome: 'child', player_score: 10, ai_score: 3 }),
        e(3, 'node_won', { node_id: 1, stars: 2 }),
        e(3, 'dragons_collected', { dragon_ids: [1] }),
        e(7, 'match_started', { match_id: m3, node_id: 2 }),
        e(8, 'match_ended', { match_id: m3, node_id: 2, outcome: 'child', player_score: 10, ai_score: 1 }),
        e(8, 'node_won', { node_id: 2, stars: 3 }),
        e(8, 'dragons_collected', { dragon_ids: [2] }),
      ];
      const ipad = [
        e(5, 'playtime', { minutes: 12 }),
        e(6, 'node_won', { node_id: 1, stars: 3 }),
        e(6, 'dragons_collected', { dragon_ids: [1, 1] }),
        e(10, 'match_started', { match_id: m2, node_id: 3 }),
        e(11, 'wrong_tap', { node_id: 3, operand_a: 2, operand_b: 5, operator: 'add', correct_answer: 7, tapped_value: 8 }),
        e(12, 'attempt', attempt({ node_id: 3 })),
        e(14, 'match_ended', { match_id: m2, node_id: 3, outcome: 'child', player_score: 10, ai_score: 6 }),
        e(14, 'node_won', { node_id: 3, stars: 2 }),
        e(14, 'dragons_collected', { dragon_ids: [3] }),
        e(16, 'node_won', { node_id: 2, stars: 1 }),
      ];
      return { iphone, ipad };
    }

    const byTime = events => [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const chunks = (events, n) => Array.from({ length: Math.ceil(events.length / n) }, (_, i) => events.slice(i * n, i * n + n));
    const kidSession = () => token(kid, 'child');
    const parentSession = () => token(parent, 'parent');

    // Everything progress is made of, as the device pulls it and as the tables
    // hold it.
    async function progressState() {
      const res = await call('GET', `/api/sync/progress?child_id=${kid}`, { as: parentSession() });
      expect(res.status).toBe(200);
      return {
        pulled: await expectContract(res, 'get', '/api/sync/progress'),
        completedAt: await q('SELECT node_id, completed_at FROM node_progress ORDER BY node_id'),
        firstCatch: await q('SELECT dragon_id, first_acquired_at FROM user_dragons ORDER BY dragon_id'),
        minutes: (await q('SELECT minute FROM play_minutes ORDER BY minute')).map(r => r.minute),
        matches: await q(`SELECT client_match_id, node_id, outcome, player_score, ai_score, started_at, ended_at
          FROM matches ORDER BY client_match_id`),
        attempts: await count('problem_attempts'),
        wrongTaps: await count('wrong_taps'),
      };
    }

    // Each plan is the uploads, in order: [events, session].
    const PLANS = [
      ['the iPhone first, then the iPad', (a, b) => [[a, kidSession], [b, kidSession]]],
      ['the iPad first, then the iPhone', (a, b) => [[b, kidSession], [a, kidSession]]],
      ['each queue newest first', (a, b) => [[[...b].reverse(), kidSession], [[...a].reverse(), kidSession]]],
      ['alternating batches of two', (a, b) => {
        const [ca, cb] = [chunks(a, 2), chunks(b, 2)];
        return Array.from({ length: Math.max(ca.length, cb.length) }, (_, i) => [ca[i], cb[i]])
          .flat().filter(Boolean).map(batch => [batch, kidSession]);
      }],
      ['one batch with both queues mixed newest first', (a, b) => [[byTime([...a, ...b]).reverse(), kidSession]]],
      ['the iPad through the parent session, the iPhone through the kid', (a, b) => [[b, parentSession], [a, kidSession]]],
      ['a lost response, so the iPhone resends everything after the iPad', (a, b) => [
        [a.slice(0, 6), kidSession], [b, kidSession], [a, kidSession], [b.slice(3), parentSession],
      ]],
    ];

    it('adds up both devices', async () => {
      const { iphone, ipad } = devices();
      await sync(byTime([...iphone, ...ipad]));
      const { pulled, minutes } = await progressState();
      expect(pulled).toEqual({
        child_id: kid,
        current_node_id: 4,
        nodes: [{ node_id: 1, stars: 3 }, { node_id: 2, stars: 3 }, { node_id: 3, stars: 2 }],
        // Dragon 1: one on the iPhone, two on the iPad. Dragon 3 is retired but
        // still counts.
        dragons: [{ dragon_id: 1, count: 3 }, { dragon_id: 2, count: 1 }, { dragon_id: 3, count: 1 }],
        // Minutes 0–9 and 5–16: the overlap counts once.
        play_minutes: 17,
        telemetry_opt_out: false,
      });
      expect(minutes).toHaveLength(17);
    });

    it.each(PLANS)('ends where one device would: %s', async (_label, plan) => {
      const { iphone, ipad } = devices();
      await sync(byTime([...iphone, ...ipad]));
      const oneDevice = await progressState();

      await resetDb();
      for (const [events, as] of plan(iphone, ipad)) {
        const { statuses } = await sync(events, as());
        expect(statuses.every(s => s === 'applied' || s === 'duplicate')).toBe(true);
      }
      expect(await progressState()).toEqual(oneDevice);
    }, 20_000); // two full runs of both queues

    it('lets a kid read their own progress with no child_id', async () => {
      await sync([ev('node_won', { node_id: 5, stars: 1 })]);
      const res = await call('GET', '/api/sync/progress', { as: kidSession() });
      expect(await expectContract(res, 'get', '/api/sync/progress')).toEqual({
        child_id: kid, current_node_id: 6, nodes: [{ node_id: 5, stars: 1 }], dragons: [], play_minutes: 0,
        telemetry_opt_out: false,
      });
    });

    it('reads a node the web route won without stars as 0 stars', async () => {
      await q('INSERT INTO node_progress (user_id, node_id, completed, stars) VALUES ($1, 2, true, NULL), ($1, 3, false, 2)', [kid]);
      const { pulled } = await progressState();
      expect(pulled.nodes).toEqual([{ node_id: 2, stars: 0 }]);
    });
  });
  describe("the parent view's summary", () => {
    const summaryPath = '/api/parent/children/{childId}/summary';
    async function summary() {
      const res = await call('GET', `/api/parent/children/${kid}/summary`, { as: token(parent, 'parent') });
      expect(res.status).toBe(200);
      return expectContract(res, 'get', summaryPath);
    }

    it('counts offline play once the queue has synced, matching what the device pulls', async () => {
      const { localDayString } = require('../lib/localTime.js');
      const before = await summary();
      expect(before).toMatchObject({
        play: { minutes_today: 0, minutes_7d: 0, minutes_total: 0, last_played_at: null },
        progress: { nodes_won: 0, stars: 0 },
        dragons: { kinds: 0, total: 0 },
        mastery: { operators: [], strongest: null, weakest: null },
      });

      // Played offline a few minutes ago, uploaded now.
      const started = Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000;
      const at = minute => new Date(started + minute * 60_000).toISOString();
      const e = (minute, kind, payload) => ({ id: randomUUID(), child_id: kid, kind, occurred_at: at(minute), payload });
      const events = [
        e(0, 'playtime', { minutes: 4 }),
        ...Array.from({ length: 5 }, () => e(1, 'attempt', attempt({ node_id: 1, operator: 'add', operand_a: 2, operand_b: 3, answer: 5 }))),
        ...Array.from({ length: 5 }, () => e(2, 'attempt', attempt({ node_id: 2 }))),
        e(2, 'attempt', attempt({ node_id: 2, outcome: 'ai' })),
        e(3, 'node_won', { node_id: 1, stars: 3 }),
        e(3, 'node_won', { node_id: 2, stars: 2 }),
        e(3, 'dragons_collected', { dragon_ids: [1, 1, 2] }),
      ];
      const { statuses } = await sync(events, token(parent, 'parent'));
      expect(statuses.every(s => s === 'applied')).toBe(true);

      const after = await summary();
      const today = localDayString();
      const minutesToday = [0, 1, 2, 3].filter(m => localDayString(new Date(started + m * 60_000)) === today).length;
      expect(after.play).toEqual({
        minutes_today: minutesToday,
        minutes_7d: 4,
        minutes_total: 4,
        last_played_at: expect.any(String),
      });
      expect(Date.parse(after.play.last_played_at)).toBeGreaterThanOrEqual(Date.parse(at(2)));
      expect(after.progress).toEqual({ current_node_id: 3, nodes_won: 2, stars: 5, three_star_nodes: 1 });
      expect(after.dragons).toEqual({ kinds: 2, total: 3 });
      expect(after.mastery).toMatchObject({ strongest: 'add', weakest: 'mul' });
      expect(after.mastery.operators.map(o => [o.operator, o.total, o.child_wins])).toEqual([
        ['add', 5, 5], ['mul', 6, 5],
      ]);

      // The same totals the child's device pulls back.
      const pulled = await expectContract(
        await call('GET', `/api/sync/progress?child_id=${kid}`, { as: token(parent, 'parent') }),
        'get', '/api/sync/progress');
      expect(after.progress.current_node_id).toBe(pulled.current_node_id);
      expect(after.progress.nodes_won).toBe(pulled.nodes.length);
      expect(after.dragons.total).toBe(pulled.dragons.reduce((n, d) => n + d.count, 0));
      expect(after.play.minutes_total).toBe(pulled.play_minutes);
    });

    it("refuses a parent who isn't linked to the child", async () => {
      const [{ id: stranger }] = await q(`INSERT INTO users (username, account_type) VALUES ('stranger', 'parent') RETURNING id`);
      const res = await call('GET', `/api/parent/children/${kid}/summary`, { as: token(stranger, 'parent') });
      expect(res.status).toBe(403);
    });
  });
});
