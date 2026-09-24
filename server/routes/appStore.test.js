// POST /api/appstore/notifications, driven over HTTP with real signed payloads.
//
// The JWS verification is Apple's own library, unmocked: server/lib/appStoreTesting.js
// generates a local root -> intermediate -> leaf chain and the verifier is told
// to trust that root instead of Apple's, so a payload here passes or fails
// exactly the checks a real one would. No network, no Apple credentials.
//
// The database is the in-memory planStore from the same helper (its methods are
// swapped onto the real module object, the same reference entitlements.js
// calls — see CLAUDE.md, Tests). ../lib/planStore.pg.test.js covers the real one.
// Each notification's effect is checked where it matters: through
// GET /api/plan/status, i.e. the resolver every plan gate uses.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DAY = 24 * 3600 * 1000;
const PARENT = 7;
const CHILD = 11;
const ORIGINAL_TX = '2000000000000001';

let server;
let baseUrl;
let kit;
let store;
let signToken;
let expectContract;
let createAppStoreRouter;
let createNotificationVerifier;
let createAppStoreTestKit;
let parentToken; // the parent's appAccountToken

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'app-store-test-secret';

  let createMemoryPlanStore;
  ({ createAppStoreTestKit, createMemoryPlanStore } = require('../lib/appStoreTesting.js'));
  ({ createNotificationVerifier } = require('../lib/appStoreVerifier.js'));
  ({ createAppStoreRouter } = require('./appStore.js'));
  ({ expectContract } = require('../contracts/testing.js'));
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });

  store = createMemoryPlanStore();
  const planStore = require('../lib/planStore.js');
  for (const name of ['accountPlanRows', 'appStoreRowsForUsers', 'guardiansOfChild', 'appAccountTokenFor', 'processNotification']) {
    planStore[name] = store[name];
  }

  kit = createAppStoreTestKit();
  const verifier = createNotificationVerifier(kit.config, { rootCertificates: [kit.rootCertificate] });

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/appstore', createAppStoreRouter({
    verifier,
    planForProductId: id => (id?.startsWith('premium.') ? 'premium' : null),
  }));
  app.use('/api/unconfigured', createAppStoreRouter({ verifier: null }));
  app.use('/api/plan', require('./plan.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(async () => {
  store.state.users.clear();
  store.state.parentLinks.length = 0;
  store.state.classroomMembers.length = 0;
  store.state.subscriptions.length = 0;
  store.state.notifications.clear();
  store.addUser({ id: PARENT, accountType: 'parent' });
  store.addUser({ id: CHILD, accountType: 'child' });
  store.state.parentLinks.push({ parentId: PARENT, childId: CHILD });
  parentToken = await store.appAccountTokenFor(PARENT);
});

async function post(signedPayload, path = '/api/appstore/notifications') {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedPayload === undefined ? {} : { signedPayload }),
  });
  return { status: res.status, body: await res.json() };
}

// Sends one notification for the parent's subscription. `at` is the signedDate
// offset from now in ms; `expiresIn` the transaction's expiresDate offset.
function notify(type, { subtype, at = 0, expiresIn = 30 * DAY, uuid, transaction = {}, renewal } = {}) {
  const signedAt = Date.now() + at;
  return post(kit.notification({
    type,
    subtype,
    uuid,
    signedAt,
    transaction: { appAccountToken: parentToken, expiresDate: signedAt + expiresIn, ...transaction },
    renewal,
  }));
}

async function planStatus(account = 'parent') {
  const claims = account === 'parent'
    ? { id: PARENT, username: 'grownup', account_type: 'parent' }
    : { id: CHILD, username: 'sparky', account_type: 'child' };
  const res = await fetch(`${baseUrl}/api/plan/status`, { headers: { Authorization: `Bearer ${signToken(claims)}` } });
  return expectContract(res, 'get', '/api/plan/status');
}

function subscription() {
  return store.state.subscriptions.find(r => r.originalTransactionId === ORIGINAL_TX && r.inAppOwnershipType === 'PURCHASED');
}

describe('purchase', () => {
  it('SUBSCRIBED credits premium to the parent the appAccountToken names, and to their kids', async () => {
    expect((await planStatus()).plan).toBe('free');

    const res = await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', renewal: {} });
    expect(res).toEqual({ status: 200, body: { received: true, outcome: 'applied' } });

    const parent = await planStatus();
    expect(parent).toMatchObject({ plan: 'premium', source: 'app_store', will_renew: true });
    expect(parent.entitlements.games_locked).toEqual([]);
    expect(parent.entitlements.child_limit).toBe(6);
    expect(subscription()).toMatchObject({ userId: PARENT, status: 'active', plan: 'premium', environment: 'Sandbox' });

    const child = await planStatus('child');
    expect(child).toMatchObject({ plan: 'premium', source: 'app_store', app_account_token: null });
  });

  it('matches the appAccountToken case-insensitively', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', transaction: { appAccountToken: parentToken.toUpperCase() } });
    expect((await planStatus()).plan).toBe('premium');
  });

  it('records a purchase whose appAccountToken matches no account, without granting anything', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', transaction: { appAccountToken: '3f0e4b1c-0000-4000-8000-000000000000' } });
    expect(subscription()).toMatchObject({ userId: null, status: 'active' });
    expect((await planStatus()).plan).toBe('free');
  });

  it('grants nothing for a product that is not mapped to a plan', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', transaction: { productId: 'tip.jar' } });
    expect(subscription()).toMatchObject({ userId: PARENT, plan: null });
    expect((await planStatus()).plan).toBe('free');
  });

  it('never lets a child account be the owner', async () => {
    store.state.users.get(CHILD).appAccountToken = '9b2f1d7e-1111-4000-8000-000000000000';
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', transaction: { appAccountToken: '9b2f1d7e-1111-4000-8000-000000000000' } });
    expect(subscription().userId).toBeNull();
  });
});

describe('renewal', () => {
  it('DID_RENEW moves the expiry forward', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -29 * DAY, expiresIn: 30 * DAY });
    const before = (await planStatus()).expires_at;
    await notify('DID_RENEW', { expiresIn: 30 * DAY });
    const after = await planStatus();
    expect(after.plan).toBe('premium');
    expect(new Date(after.expires_at) - new Date(before)).toBeGreaterThan(28 * DAY);
  });

  it('DID_FAIL_TO_RENEW with a grace period keeps premium until the grace period ends', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -30 * DAY, expiresIn: 30 * DAY - 1000 });
    const graceEnds = Date.now() + 6 * DAY;
    await notify('DID_FAIL_TO_RENEW', { subtype: 'GRACE_PERIOD', expiresIn: -1000, renewal: { gracePeriodExpiresDate: graceEnds } });
    const status = await planStatus();
    expect(status).toMatchObject({ plan: 'premium', source: 'app_store', will_renew: null });
    expect(new Date(status.expires_at).getTime()).toBe(graceEnds);
    expect(subscription().status).toBe('grace_period');
  });

  it('DID_FAIL_TO_RENEW without a grace period drops to free, and BILLING_RECOVERY restores it', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -30 * DAY, expiresIn: 30 * DAY - 1000 });
    await notify('DID_FAIL_TO_RENEW', { expiresIn: -1000, at: -500 });
    expect(subscription().status).toBe('billing_retry');
    expect((await planStatus()).plan).toBe('free');

    await notify('DID_RENEW', { subtype: 'BILLING_RECOVERY' });
    expect((await planStatus()).plan).toBe('premium');
  });

  it('DID_CHANGE_RENEWAL_STATUS updates will_renew without touching access', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', renewal: {} });
    await notify('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_DISABLED', renewal: { autoRenewStatus: 0 } });
    expect(await planStatus()).toMatchObject({ plan: 'premium', will_renew: false });
    expect(subscription()).toMatchObject({ status: 'active', autoRenew: false });

    await notify('DID_CHANGE_RENEWAL_STATUS', { subtype: 'AUTO_RENEW_ENABLED', renewal: { autoRenewStatus: 1 } });
    expect((await planStatus()).will_renew).toBe(true);
  });
});

describe('expiry', () => {
  it('EXPIRED drops the family to free', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -30 * DAY });
    await notify('EXPIRED', { subtype: 'VOLUNTARY', expiresIn: -1000 });
    expect(subscription().status).toBe('expired');
    expect((await planStatus()).plan).toBe('free');
    expect((await planStatus('child')).plan).toBe('free');
  });

  it('lapses at expiresDate even if the EXPIRED notification never arrives', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -40 * DAY, expiresIn: 30 * DAY });
    expect(subscription().status).toBe('active');
    expect((await planStatus()).plan).toBe('free');
  });
});

describe('refund and revocation', () => {
  it('REFUND takes premium away', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY' });
    await notify('REFUND', { transaction: { revocationDate: Date.now() } });
    expect(subscription().status).toBe('refunded');
    expect((await planStatus()).plan).toBe('free');
  });

  it("REVOKE ends a Family Sharing member's copy without touching the purchaser's", async () => {
    // Another parent, credited through Family Sharing on the same subscription.
    store.addUser({ id: 8, accountType: 'parent' });
    const sharedToken = await store.appAccountTokenFor(8);
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY' });
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', transaction: { inAppOwnershipType: 'FAMILY_SHARED', appAccountToken: sharedToken } });
    await notify('REVOKE', { transaction: { inAppOwnershipType: 'FAMILY_SHARED', appAccountToken: sharedToken, revocationDate: Date.now() } });

    const shared = store.state.subscriptions.find(r => r.inAppOwnershipType === 'FAMILY_SHARED');
    expect(shared).toMatchObject({ userId: 8, status: 'revoked' });
    expect(subscription().status).toBe('active');
    expect((await planStatus()).plan).toBe('premium');
  });
});

describe('delivery', () => {
  it('is idempotent by notificationUUID', async () => {
    const expiredUuid = '5d1c7f2a-2222-4000-8000-000000000000';
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -30 * DAY });
    await notify('EXPIRED', { uuid: expiredUuid, at: -DAY, expiresIn: -1000 });
    await notify('SUBSCRIBED', { subtype: 'RESUBSCRIBE' });
    expect((await planStatus()).plan).toBe('premium');

    // Apple redelivers the EXPIRED (e.g. our 200 was lost): acknowledged, not re-applied.
    const again = await notify('EXPIRED', { uuid: expiredUuid, expiresIn: -1000 });
    expect(again).toEqual({ status: 200, body: { received: true, outcome: 'duplicate' } });
    expect((await planStatus()).plan).toBe('premium');
  });

  it('does not let a late, older notification overwrite newer state', async () => {
    await notify('SUBSCRIBED', { subtype: 'INITIAL_BUY', at: -30 * DAY });
    await notify('DID_RENEW');
    const late = await notify('EXPIRED', { at: -DAY, expiresIn: -1000 });
    expect(late.body.outcome).toBe('stale');
    expect((await planStatus()).plan).toBe('premium');
  });

  it('acknowledges notification types it does not act on', async () => {
    expect((await post(kit.notification({ type: 'TEST', transaction: null }))).body.outcome).toBe('ignored');
    expect((await notify('CONSUMPTION_REQUEST')).body.outcome).toBe('ignored');
    expect(store.state.subscriptions).toEqual([]);
  });
});

describe('verification', () => {
  it('rejects a payload signed by a chain that is not the trusted root', async () => {
    const impostor = createAppStoreTestKit();
    const res = await post(impostor.notification({ type: 'SUBSCRIBED', transaction: { appAccountToken: parentToken } }));
    expect(res).toEqual({ status: 400, body: { error: 'Invalid signedPayload.' } });
    expect(store.state.subscriptions).toEqual([]);
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = kit.notification({ type: 'SUBSCRIBED', transaction: { appAccountToken: parentToken } }).split('.');
    const forged = Buffer.from(JSON.stringify({ notificationType: 'SUBSCRIBED', notificationUUID: 'x', signedDate: Date.now(), data: {} })).toString('base64url');
    expect((await post(`${header}.${forged}.${signature}`)).status).toBe(400);
  });

  it('rejects another app or another environment', async () => {
    expect((await post(kit.notification({ type: 'SUBSCRIBED', payloadBundleId: 'com.someone.else' }))).status).toBe(400);
    expect((await post(kit.notification({ type: 'SUBSCRIBED', payloadEnvironment: 'Production' }))).status).toBe(400);
    expect(store.state.notifications.size).toBe(0);
  });

  it('rejects a missing or non-JWS body', async () => {
    expect(await post(undefined)).toEqual({ status: 400, body: { error: 'signedPayload is required' } });
    expect((await post('not-a-jws')).status).toBe(400);
  });

  it('503s while App Store notifications are not configured', async () => {
    expect((await post('anything', '/api/unconfigured/notifications')).status).toBe(503);
  });
});
