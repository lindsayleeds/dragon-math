// GET /api/plan/status against its contract (server/contracts/plan.js), and the
// resolver's precedence as the route reports it: Stripe, App Store, comp, admin
// and classroom grants collapse to one plan per family, highest wins. Each case
// also asks the helpers the existing gates call (planForUser,
// effectivePlanForChild) so the endpoint and the enforcement are shown to agree.
//
// Data comes from the in-memory planStore (server/lib/appStoreTesting.js),
// swapped onto the real module object that entitlements.js calls.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DAY = 24 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let server;
let baseUrl;
let store;
let signToken;
let expectContract;
let entitlements;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'plan-contract-test-secret';

  const { createMemoryPlanStore } = require('../lib/appStoreTesting.js');
  store = createMemoryPlanStore();
  const planStore = require('../lib/planStore.js');
  for (const name of ['accountPlanRows', 'appStoreRowsForUsers', 'guardiansOfChild', 'appAccountTokenFor', 'processNotification']) {
    planStore[name] = store[name];
  }
  entitlements = require('../lib/entitlements.js');
  ({ expectContract } = require('../contracts/testing.js'));
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });

  const express = require('express');
  const app = express();
  app.use('/api/plan', require('./plan.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  store.state.users.clear();
  store.state.parentLinks.length = 0;
  store.state.classroomMembers.length = 0;
  store.state.subscriptions.length = 0;
});

async function status(id, account_type = 'parent') {
  const headers = { Authorization: `Bearer ${signToken({ id, username: `u${id}`, account_type })}` };
  const res = await fetch(`${baseUrl}/api/plan/status`, { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return expectContract(res, 'get', '/api/plan/status');
}

const stripePlan = (plan, extra = {}) => ({
  plan, planStatus: 'active', stripeSubscriptionId: 'sub_123', planRenewsAt: new Date(Date.now() + 20 * DAY), ...extra,
});

function appStorePlan(userId, extra = {}) {
  store.state.subscriptions.push({
    userId,
    originalTransactionId: `tx-${userId}-${store.state.subscriptions.length}`,
    inAppOwnershipType: 'PURCHASED',
    plan: 'premium',
    status: 'active',
    expiresAt: new Date(Date.now() + 10 * DAY),
    gracePeriodExpiresAt: null,
    autoRenew: true,
    ...extra,
  });
}

describe('GET /api/plan/status', () => {
  it('reports a free parent, with the appAccountToken StoreKit needs', async () => {
    store.addUser({ id: 1 });
    const body = await status(1);
    expect(body).toEqual({
      plan: 'free',
      source: null,
      expires_at: null,
      will_renew: null,
      grants: [],
      entitlements: {
        games_locked: ['dragon-munchers', 'dragon-spelling', 'proving-grounds'],
        child_limit: 1,
        can_use_digest: false,
      },
      app_account_token: expect.stringMatching(UUID_RE),
    });
    // Stable: the same token every time, so every purchase lands on this account.
    expect((await status(1)).app_account_token).toBe(body.app_account_token);
  });

  it('gives a kid no appAccountToken', async () => {
    store.addUser({ id: 11, accountType: 'child' });
    expect((await status(11, 'child')).app_account_token).toBeNull();
  });

  it('401s without a session', async () => {
    const res = await fetch(`${baseUrl}/api/plan/status`);
    expect(res.status).toBe(401);
    await expectContract(res, 'get', '/api/plan/status');
  });
});

describe('precedence', () => {
  it('Stripe premium alone', async () => {
    store.addUser({ id: 1, ...stripePlan('premium', { planCancelAtPeriodEnd: true }) });
    const body = await status(1);
    expect(body).toMatchObject({ plan: 'premium', source: 'stripe', will_renew: false });
    expect(await entitlements.planForUser(1)).toBe('premium');
  });

  it('App Store premium alone — users.plan is still free, the resolver says premium', async () => {
    store.addUser({ id: 1 });
    appStorePlan(1);
    expect(await status(1)).toMatchObject({ plan: 'premium', source: 'app_store', will_renew: true });
    expect(await entitlements.planForUser(1)).toBe('premium');
  });

  it('Stripe and App Store at the same plan report Stripe first and list both', async () => {
    store.addUser({ id: 1, ...stripePlan('premium') });
    appStorePlan(1);
    const body = await status(1);
    expect(body.source).toBe('stripe');
    expect(body.grants.map(g => g.source)).toEqual(['stripe', 'app_store']);
  });

  it('the higher plan wins whatever its source', async () => {
    store.addUser({ id: 1, adultRole: 'teacher', ...stripePlan('classroom') });
    appStorePlan(1);
    const body = await status(1);
    expect(body).toMatchObject({ plan: 'classroom', source: 'stripe' });
    expect(body.entitlements.child_limit).toBeNull();
  });

  it('a comp outranks a same-plan purchase, and a manual grant still counts', async () => {
    store.addUser({ id: 1, plan: 'premium', comped: true, planStatus: 'comped' });
    appStorePlan(1);
    expect((await status(1)).source).toBe('comp');

    store.addUser({ id: 2, plan: 'premium' }); // admin toggle: no Stripe subscription
    expect(await status(2)).toMatchObject({ plan: 'premium', source: 'manual' });
  });

  it('a canceled Stripe subscription grants nothing, so the App Store one is what counts', async () => {
    store.addUser({ id: 1, plan: 'free', planStatus: 'canceled', stripeSubscriptionId: null });
    appStorePlan(1);
    expect(await status(1)).toMatchObject({ plan: 'premium', source: 'app_store' });
  });

  it('an App Store row past its expiry, refunded or unlinked grants nothing', async () => {
    store.addUser({ id: 1 });
    appStorePlan(1, { expiresAt: new Date(Date.now() - 1000) });
    appStorePlan(1, { status: 'refunded' });
    appStorePlan(null);
    expect((await status(1)).plan).toBe('free');
    expect(await entitlements.planForUser(1)).toBe('free');
  });

  it("a kid gets the best of every guardian: a parent's App Store premium, a teacher's classroom", async () => {
    store.addUser({ id: 1 });
    store.addUser({ id: 2, adultRole: 'teacher', plan: 'classroom' });
    store.addUser({ id: 11, accountType: 'child' });
    store.state.parentLinks.push({ parentId: 1, childId: 11 });
    appStorePlan(1);

    expect(await status(11, 'child')).toMatchObject({ plan: 'premium', source: 'app_store' });
    expect(await entitlements.effectivePlanForChild(11)).toBe('premium');

    store.state.classroomMembers.push({ teacherId: 2, childId: 11 });
    const body = await status(11, 'child');
    expect(body).toMatchObject({ plan: 'classroom', source: 'classroom' });
    expect(body.grants.map(g => g.source)).toEqual(['classroom', 'app_store']);
    expect(body.entitlements.games_locked).toEqual([]);
    expect(await entitlements.effectivePlanForChild(11)).toBe('classroom');
  });

  it('a kid with no paying guardian is free', async () => {
    store.addUser({ id: 1 });
    store.addUser({ id: 11, accountType: 'child' });
    store.state.parentLinks.push({ parentId: 1, childId: 11 });
    expect((await status(11, 'child')).plan).toBe('free');
    expect(await entitlements.effectivePlanForChild(11)).toBe('free');
  });
});
