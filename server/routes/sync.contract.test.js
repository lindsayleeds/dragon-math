// POST /api/sync/events (and GET /api/sync/progress), driven over HTTP and checked against its contract
// (server/contracts/sync.js) with no database: the paths here are the ones
// decided before an event's transaction opens — auth, the batch envelope, and
// per-event validation and child access. Everything that writes is covered
// against a real Postgres by sync.pg.test.js.
//
// Server code is CommonJS, so fakes are wired the plain Node way (see CLAUDE.md,
// Tests): Module._load for the rate limiter, and methods replaced on the object
// `require('../db')` returns. The fake refuses to open a transaction, so a test
// here that reached one would fail loudly rather than pass on a fake write.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let signToken;
let expectContract;
let linkRows;
let rateAllowed;

const KID = 11;
const PARENT = 7;

function post(body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/sync/events`, { method: 'POST', headers, body: JSON.stringify(body) });
}

const kidToken = () => signToken({ id: KID, username: 'sparky', account_type: 'child' });
const parentToken = () => signToken({ id: PARENT, username: 'grownup', account_type: 'parent' });

const event = (overrides = {}) => ({
  id: randomUUID(),
  child_id: KID,
  kind: 'node_won',
  occurred_at: '2026-09-20T15:04:05.123Z',
  payload: { node_id: 3, stars: 2 },
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'sync-contract-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: rateAllowed }) };
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  // The one read made before a transaction: the parent_child_links lookup.
  dbModule.db.select = () => ({
    from() { return this; },
    where() { return this; },
    limit() { return Promise.resolve(linkRows); },
  });
  dbModule.db.transaction = () => { throw new Error('this test must not reach a transaction'); };

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/sync', require('./sync.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  linkRows = [];
  rateAllowed = true;
});

describe('POST /api/sync/events contract', () => {
  it('needs a session', async () => {
    const res = await post({ events: [event()] });
    expect(res.status).toBe(401);
    await expectContract(res, 'post', '/api/sync/events');
  });

  it('refuses a parent API key, which is not a session', async () => {
    const res = await post({ events: [event()] }, `dmk_${'a'.repeat(43)}`);
    expect(res.status).toBe(401);
  });

  it('is rate limited per user', async () => {
    rateAllowed = false;
    const res = await post({ events: [event()] }, kidToken());
    expect(res.status).toBe(429);
    await expectContract(res, 'post', '/api/sync/events');
  });

  it.each([
    ['a body that is not an object', [], 'events must be an array'],
    ['events that are not an array', { events: 'lots' }, 'events must be an array'],
    ['an empty batch', { events: [] }, 'events must not be empty'],
    ['more than 100 events', { events: Array.from({ length: 101 }, () => event()) }, 'At most 100 events per request'],
  ])('rejects %s with a 400', async (_label, body, error) => {
    const res = await post(body, kidToken());
    expect(res.status).toBe(400);
    expect(await expectContract(res, 'post', '/api/sync/events')).toEqual({ error });
  });

  it('judges each event on its own and says why each was refused', async () => {
    const events = [
      event({ id: 'nope' }),
      event({ child_id: 12 }),
      event({ occurred_at: '2026-09-20 15:04' }),
      event({ kind: 'Node Won' }),
      event({ payload: [1, 2] }),
      event({ payload: { node_id: 3, stars: 5 } }),
      event({ kind: 'attempt', payload: { node_id: 1 } }),
      event({ kind: 'match_ended', payload: { match_id: 'x', node_id: 1, outcome: 'child', player_score: 1, ai_score: 0 } }),
      event({ kind: 'dragons_collected', payload: { dragon_ids: [] } }),
      null,
    ];
    const res = await post({ events }, kidToken());
    expect(res.status).toBe(200);
    const { results } = await expectContract(res, 'post', '/api/sync/events');

    expect(results.map(r => [r.index, r.status, r.reason, r.acknowledged])).toEqual([
      [0, 'rejected', 'invalid_event', true],
      [1, 'rejected', 'not_your_child', true],
      [2, 'rejected', 'invalid_event', true],
      [3, 'rejected', 'invalid_event', true],
      [4, 'rejected', 'invalid_event', true],
      [5, 'rejected', 'invalid_payload', true],
      [6, 'rejected', 'invalid_payload', true],
      [7, 'rejected', 'invalid_payload', true],
      [8, 'rejected', 'invalid_payload', true],
      [9, 'rejected', 'invalid_event', true],
    ]);
    expect(results.map(r => r.message)).toEqual([
      'id: id must be a UUID',
      'You can only send events for your own account or a linked child.',
      'occurred_at: occurred_at must be an ISO 8601 date-time',
      'kind: kind must be lower-case letters, digits, _ . or -',
      'payload: payload must be an object',
      'stars: stars must be at most 3',
      'operand_a: operand_a must be a whole number',
      'match_id: match_id must be a UUID',
      'dragon_ids: dragon_ids must not be empty',
      'Invalid input: expected object, received null',
    ]);
    expect(results[0].id).toBe('nope');
    expect(results[1].id).toBe(events[1].id);
    expect(results[9].id).toBeNull();
  });

  it('lets a parent write only for a linked child', async () => {
    linkRows = [];
    const res = await post({ events: [event()] }, parentToken());
    const { results } = await expectContract(res, 'post', '/api/sync/events');
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'not_your_child' });
  });
});

// Only the refusals: they are decided before any read. What a real read
// returns is in sync.pg.test.js.
describe('GET /api/sync/progress contract', () => {
  const get = (query, token) => fetch(`${baseUrl}/api/sync/progress${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  it('needs a session', async () => {
    const res = await get(`?child_id=${KID}`);
    expect(res.status).toBe(401);
    await expectContract(res, 'get', '/api/sync/progress');
  });

  it('rejects a child_id that is not a positive whole number', async () => {
    const res = await get('?child_id=abc', parentToken());
    expect(res.status).toBe(400);
    expect(await expectContract(res, 'get', '/api/sync/progress')).toEqual({ error: 'Invalid child id' });
  });

  it.each([
    ['a kid asking for someone else', '?child_id=12', kidToken],
    ['a parent asking for a child who is not theirs', `?child_id=${KID}`, parentToken],
    ['a parent naming no child', '', parentToken],
  ])('refuses %s', async (_label, query, token) => {
    linkRows = [];
    const res = await get(query, token());
    expect(res.status).toBe(403);
    expect(await expectContract(res, 'get', '/api/sync/progress')).toEqual({ error: 'Not your child' });
  });
});
