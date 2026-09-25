// GET and POST /api/parent/children, and PUT …/:childId/telemetry, against their contract
// (server/contracts/children.js), which the iOS parent view is generated from,
// and the plan's child limit as the create route enforces it: the plan comes
// from the real resolver (server/lib/planStatus.js via entitlements.js) over the
// in-memory planStore, so an App Store subscriber whose users.plan column says
// free still gets premium's limit.
//
// The database is faked on the object `require('../db')` returns: the child
// count is `linked`, and the create transaction records its inserts and links
// the new child (bumping `linked`), so creating past the limit is driven for real.
// The ownership check (requireOwnsChild) finds a link while `owned` is true, and
// updates are recorded in `updates`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const DAY = 24 * 3600 * 1000;
const PARENT_ID = 7;

let server;
let baseUrl;
let originalLoad;
let store;
let signToken;
let expectContract;
let linked;
let inserts;
let listRows;
let rateAllowed;
let owned;
let updates;

function fakeSelect() {
  return {
    from() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    limit() { return Promise.resolve(owned ? [{ parentId: PARENT_ID }] : []); },
    then(resolve, reject) { return Promise.resolve([{ count: linked }]).then(resolve, reject); },
  };
}

function fakeTx() {
  return {
    insert() {
      return {
        values(values) { inserts.push(values); return this; },
        returning() {
          return Promise.resolve([{ id: 100 + inserts.length, avatar: '⚔️', current_node_id: 1 }]);
        },
        onConflictDoNothing() { linked += 1; return Promise.resolve(); },
      };
    },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'children-contract-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: rateAllowed }) };
    return originalLoad.call(this, request, parent, isMain);
  };

  const { createMemoryPlanStore } = require('../lib/appStoreTesting.js');
  store = createMemoryPlanStore();
  const planStore = require('../lib/planStore.js');
  for (const name of ['accountPlanRows', 'appStoreRowsForUsers', 'guardiansOfChild', 'appAccountTokenFor']) {
    planStore[name] = store[name];
  }

  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;
  dbModule.db.transaction = async fn => fn(fakeTx());
  dbModule.db.execute = async () => ({ rows: listRows });
  dbModule.db.update = () => ({
    set(values) { this.values = values; return this; },
    where() { updates.push(this.values); return Promise.resolve(); },
  });

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/parent', require('./parent.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60_000); // parent.js pulls in most of the server; slow to load on a busy machine

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  store.state.users.clear();
  store.state.subscriptions.length = 0;
  linked = 0;
  inserts = [];
  listRows = [];
  rateAllowed = true;
  owned = true;
  updates = [];
});

const parentToken = (extra = {}) =>
  signToken({ id: PARENT_ID, username: 'grownup', account_type: 'parent', adult_role: 'parent', ...extra });

async function call(method, { token = parentToken(), body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}/api/parent/children`, {
    method: method.toUpperCase(),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await expectContract(res, method, '/api/parent/children') };
}

const create = body => call('post', { body });

describe('POST /api/parent/children', () => {
  it('creates a linked child with the name the parent gave', async () => {
    store.addUser({ id: PARENT_ID });
    const res = await create({ real_name: '  Ada Lovelace ' });
    expect(res.status).toBe(201);
    expect(res.body.child).toEqual({
      id: 101,
      username: null,
      real_name: 'Ada Lovelace',
      avatar: '⚔️',
      current_node_id: 1,
      needs_handle: true,
      login_token: expect.any(String),
    });
    const [user, link] = inserts;
    expect(user).toMatchObject({ accountType: 'child', needsHandle: true, realName: 'Ada Lovelace' });
    // The placeholder handle is the login token; font is left to the column default.
    expect(user.username).toBe(res.body.child.login_token);
    expect(user).not.toHaveProperty('font');
    expect(link).toEqual({ parentId: PARENT_ID, childId: 101 });
  });

  it('accepts the web dashboard\'s empty body, and treats a blank name as none', async () => {
    store.addUser({ id: PARENT_ID, plan: 'premium', comped: true });
    expect((await create({})).body.child.real_name).toBeNull();
    expect((await create({ real_name: '   ' })).body.child.real_name).toBeNull();
    expect(inserts.filter(v => 'realName' in v).map(v => v.realName)).toEqual([null, null]);
  });

  it('rejects a name that is too long or not a string', async () => {
    store.addUser({ id: PARENT_ID });
    const long = await create({ real_name: 'x'.repeat(81) });
    expect(long).toEqual({ status: 400, body: { error: 'Name must be at most 80 characters.' } });
    expect((await create({ real_name: 42 })).status).toBe(400);
    expect(inserts).toEqual([]);
  });

  describe('plan limits', () => {
    it('lets a free parent add one child, then answers 402 child_limit', async () => {
      store.addUser({ id: PARENT_ID });
      expect((await create({ real_name: 'First' })).status).toBe(201);
      const res = await create({ real_name: 'Second' });
      expect(res).toEqual({
        status: 402,
        body: {
          error: "You've reached the 1-child limit on the Free plan. Upgrade to Premium to add more.",
          code: 'child_limit',
          plan: 'free',
          limit: 1,
        },
      });
      expect(linked).toBe(1);
    });

    it('stops a premium parent at six children', async () => {
      store.addUser({ id: PARENT_ID, plan: 'premium', planStatus: 'active', stripeSubscriptionId: 'sub_1' });
      linked = 5;
      expect((await create({})).status).toBe(201);
      const res = await create({});
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({ code: 'child_limit', plan: 'premium', limit: 6 });
      expect(res.body.error).toBe("You've reached your plan's child limit. Upgrade to add more.");
    });

    it('gives an App Store subscriber premium\'s limit though users.plan says free', async () => {
      store.addUser({ id: PARENT_ID });
      store.state.subscriptions.push({
        userId: PARENT_ID, originalTransactionId: 'tx-1', inAppOwnershipType: 'PURCHASED', plan: 'premium',
        status: 'active', expiresAt: new Date(Date.now() + 10 * DAY), gracePeriodExpiresAt: null, autoRenew: true,
      });
      linked = 1;
      expect((await create({})).status).toBe(201);
    });

    it('counts an over-limit family (e.g. after a downgrade) as at the limit', async () => {
      store.addUser({ id: PARENT_ID });
      linked = 3;
      expect((await create({})).body).toMatchObject({ code: 'child_limit', limit: 1 });
      expect(inserts).toEqual([]);
    });
  });

  it('401s without a session, 403s for a kid, 429s when rate limited', async () => {
    expect((await call('post', { token: null, body: {} })).status).toBe(401);
    const kid = signToken({ id: 11, username: 'sparky', account_type: 'child' });
    expect((await call('post', { token: kid, body: {} })).status).toBe(403);
    rateAllowed = false;
    expect((await create({})).status).toBe(429);
  });
});

describe('GET /api/parent/children', () => {
  it('lists the linked children', async () => {
    listRows = [
      {
        id: 101, username: 'sparky', real_name: 'Ada', avatar: '🐉', current_node_id: 4,
        created_at: new Date('2026-09-01T10:00:00.123Z'), needs_handle: false,
        login_token: '0f8fad5b-d9cb-469f-a165-70867728950e',
        last_attempt_at: new Date('2026-09-20T08:30:00Z'), minutes_today: 5, minutes_7d: 42,
        telemetry_opt_out: true,
      },
      {
        id: 102, username: '7c9e6679-7425-40de-944b-e07fc1f90ae7', real_name: null, avatar: '⚔️',
        current_node_id: 1, created_at: new Date('2026-09-02T10:00:00Z'), needs_handle: true,
        login_token: '7c9e6679-7425-40de-944b-e07fc1f90ae7', last_attempt_at: null, minutes_today: 0, minutes_7d: 0,
        telemetry_opt_out: false,
      },
    ];
    const res = await call('get');
    expect(res.status).toBe(200);
    expect(res.body.children.map(c => [c.id, c.real_name, c.created_at, c.telemetry_opt_out])).toEqual([
      [101, 'Ada', '2026-09-01T10:00:00.123Z', true],
      [102, null, '2026-09-02T10:00:00.000Z', false],
    ]);
  });

  it('401s without a session and 403s for a kid', async () => {
    expect((await call('get', { token: null })).status).toBe(401);
    expect((await call('get', { token: signToken({ id: 11, account_type: 'child' }) })).status).toBe(403);
  });
});

describe('PUT /api/parent/children/:childId/telemetry', () => {
  async function put(childId, body, token = parentToken()) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/api/parent/children/${childId}/telemetry`, {
      method: 'PUT', headers, body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await expectContract(res, 'put', '/api/parent/children/{childId}/telemetry'),
    };
  }

  it('turns a linked child\'s telemetry off, and back on', async () => {
    expect(await put(101, { telemetry_opt_out: true })).toEqual({
      status: 200, body: { id: 101, telemetry_opt_out: true },
    });
    expect(await put(101, { telemetry_opt_out: false })).toEqual({
      status: 200, body: { id: 101, telemetry_opt_out: false },
    });
    expect(updates).toEqual([{ telemetryOptOut: true }, { telemetryOptOut: false }]);
  });

  it('needs a true or false', async () => {
    for (const body of [{}, { telemetry_opt_out: 'yes' }, { telemetry_opt_out: null }]) {
      expect(await put(101, body)).toEqual({
        status: 400, body: { error: 'telemetry_opt_out must be true or false' },
      });
    }
    expect(updates).toEqual([]);
  });

  it('refuses a child who is not linked to this parent, a bad id, a kid, and no session', async () => {
    owned = false;
    expect(await put(101, { telemetry_opt_out: true })).toEqual({ status: 403, body: { error: 'Not your child' } });
    owned = true;
    expect((await put('abc', { telemetry_opt_out: true })).status).toBe(400);
    const kid = signToken({ id: 101, username: 'sparky', account_type: 'child' });
    expect((await put(101, { telemetry_opt_out: false }, kid)).status).toBe(403);
    expect((await put(101, { telemetry_opt_out: true }, null)).status).toBe(401);
    expect(updates).toEqual([]);
  });
});
