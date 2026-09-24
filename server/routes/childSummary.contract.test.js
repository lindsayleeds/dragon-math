// GET /api/parent/children/:childId/summary against its contract
// (server/contracts/children.js), which the iOS parent view's per-child stats
// are generated from, plus the strongest/weakest rule on plain rows.
//
// The database is faked on the object `require('../db')` returns: `select` (the
// ownership check, then the child lookup) answers from a queue, and `execute`
// answers by what the compiled SQL reads, so the real buildChildSummary runs.
// That synced offline play shows up here is pinned against a real Postgres in
// sync.pg.test.js.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PARENT_ID = 7;
const CHILD_ID = 101;
const PATH = '/api/parent/children/{childId}/summary';

let server;
let baseUrl;
let signToken;
let expectContract;
let operatorHighlights;
let selectQueue;
let tables;
let executed;

function fakeSelect() {
  const rows = selectQueue.length > 1 ? selectQueue.shift() : selectQueue[0];
  return {
    from() { return this; },
    where() { return this; },
    limit() { return Promise.resolve(rows); },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'child-summary-contract-test-secret';

  const { PgDialect } = require('drizzle-orm/pg-core');
  const dialect = new PgDialect();
  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;
  dbModule.db.execute = async query => {
    const text = dialect.sqlToQuery(query).sql;
    executed.push(text);
    if (text.includes('FROM users')) return { rows: [{ current_node_id: tables.currentNode }] };
    if (text.includes('FROM node_progress')) return { rows: tables.nodes };
    if (text.includes('FROM user_dragons')) return { rows: tables.dragons };
    if (text.includes('GROUP BY operator')) return { rows: tables.byOperator };
    if (text.includes('GREATEST')) return { rows: [{ at: tables.lastAt }] };
    if (text.includes('FILTER')) return { rows: [{ today: tables.today, week: tables.week }] };
    if (text.includes('FROM play_minutes')) return { rows: [{ minutes: tables.total }] };
    throw new Error(`Unexpected query: ${text}`);
  };

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));
  ({ operatorHighlights } = require('../lib/analytics.js'));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/parent', require('./parent.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60_000); // parent.js pulls in most of the server; slow to load on a busy machine

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectQueue = [[{ parentId: PARENT_ID, id: CHILD_ID, username: 'sparky', avatar: '🐉' }]];
  executed = [];
  tables = {
    currentNode: 4,
    nodes: [{ node_id: 1, stars: 3 }, { node_id: 2, stars: 2 }, { node_id: 3, stars: 3 }],
    dragons: [{ dragon_id: 1, count: 3 }, { dragon_id: 5, count: 1 }],
    byOperator: [
      { operator: 'add', total: 20, child_wins: 18, ai_wins: 2, avg_child_ms: 2100.5 },
      { operator: 'mul', total: 10, child_wins: 6, ai_wins: 4, avg_child_ms: 4200 },
    ],
    lastAt: new Date('2026-09-20T08:30:00.123Z'),
    today: 12,
    week: 45,
    total: 300,
  };
});

const parentToken = () =>
  signToken({ id: PARENT_ID, username: 'grownup', account_type: 'parent', adult_role: 'parent' });

async function get(childId = CHILD_ID, token = parentToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${baseUrl}/api/parent/children/${childId}/summary`, { headers });
  return { status: res.status, body: await expectContract(res, 'get', PATH) };
}

describe('GET /api/parent/children/:childId/summary', () => {
  it('sums up play, progress, dragons and operations', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      child_id: CHILD_ID,
      play: { minutes_today: 12, minutes_7d: 45, minutes_total: 300, last_played_at: '2026-09-20T08:30:00.123Z' },
      progress: { current_node_id: 4, nodes_won: 3, stars: 8, three_star_nodes: 2 },
      dragons: { kinds: 2, total: 4 },
      mastery: {
        window_days: 30,
        min_attempts: 5,
        operators: [
          { operator: 'add', total: 20, child_wins: 18, accuracy: 0.9, avg_child_ms: 2100.5 },
          { operator: 'mul', total: 10, child_wins: 6, accuracy: 0.6, avg_child_ms: 4200 },
        ],
        strongest: 'add',
        weakest: 'mul',
      },
    });
  });

  it('answers zeros and nulls for a child who has never played', async () => {
    Object.assign(tables, { currentNode: 1, nodes: [], dragons: [], byOperator: [], lastAt: null, today: 0, week: 0, total: 0 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.play).toEqual({ minutes_today: 0, minutes_7d: 0, minutes_total: 0, last_played_at: null });
    expect(res.body.progress).toEqual({ current_node_id: 1, nodes_won: 0, stars: 0, three_star_nodes: 0 });
    expect(res.body.dragons).toEqual({ kinds: 0, total: 0 });
    expect(res.body.mastery).toMatchObject({ operators: [], strongest: null, weakest: null });
  });

  it('reads the last 30 days of answers and this week of minutes', async () => {
    await get();
    expect(executed.find(t => t.includes('GROUP BY operator'))).toMatch(/created_at >= \$\d+/);
    expect(executed.find(t => t.includes('FILTER'))).toMatch(/minute >= \$\d+/);
  });

  it('403s for a child who is not linked, 404s for one who is gone', async () => {
    selectQueue = [[]];
    expect(await get()).toEqual({ status: 403, body: { error: 'Not your child' } });
    selectQueue = [[{ parentId: PARENT_ID }], []];
    expect(await get()).toEqual({ status: 404, body: { error: 'Child not found' } });
  });

  it('400s a bad id, 401s without a session and 403s for a kid', async () => {
    expect((await get('abc')).status).toBe(400);
    expect((await get(CHILD_ID, null)).status).toBe(401);
    expect((await get(CHILD_ID, signToken({ id: 11, account_type: 'child' }))).status).toBe(403);
  });
});

describe('operatorHighlights', () => {
  const row = (operator, total, childWins, avg = 3000) => ({ operator, total, child_wins: childWins, avg_child_ms: avg });

  it('ignores operations with too few answers to judge', () => {
    const out = operatorHighlights([row('add', 4, 4), row('sub', 10, 5), row('div', 6, 3)]);
    expect(out.operators.map(o => o.operator)).toEqual(['add', 'sub', 'div']);
    // add is 4/4 but below the minimum; sub and div tie on accuracy and pace,
    // so the fixed order decides and there is no weaker one.
    expect(out).toMatchObject({ strongest: 'sub', weakest: null });
  });

  it('breaks an accuracy tie with the faster pace', () => {
    const out = operatorHighlights([row('add', 10, 8, 4000), row('mul', 10, 8, 2500), row('div', 10, 5)]);
    expect(out).toMatchObject({ strongest: 'mul', weakest: 'div' });
  });

  it('names no weakest with a single operation', () => {
    expect(operatorHighlights([row('mul', 12, 3)])).toMatchObject({ strongest: 'mul', weakest: null });
  });

  it('treats a missing pace as the slowest', () => {
    const out = operatorHighlights([row('add', 5, 0, null), row('sub', 5, 0, 9000), row('mul', 5, 5)]);
    expect(out).toMatchObject({ strongest: 'mul', weakest: 'add' });
    expect(out.operators[0]).toMatchObject({ accuracy: 0, avg_child_ms: null });
  });
});
