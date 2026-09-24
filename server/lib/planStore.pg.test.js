// Real-Postgres cover for ./planStore.js — the parts only a database can
// answer: that the notificationUUID unique index makes a redelivery a no-op,
// that a failed apply rolls the idempotency row back so Apple's retry is
// processed, that the upsert's signedDate guard settles a first-sight race, and
// that the resolver's reads (users, App Store rows, guardians) join correctly.
// The rules themselves are covered without a database by
// server/routes/appStore.test.js and ./appStoreNotifications.test.js.
//
// Opt-in, like every *.pg.test.js:
//
//   TEST_DATABASE_URL=postgres://user@host:5432/scratch_db npm test
//
// It works in a schema of its own (dropped afterwards), selected for the whole
// pool through the connection string, so it cannot collide with the other
// suites' tables in the same database. The tables are created here to match
// server/db/schema.js, so `drizzle-kit push` need not have run.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

const DAY = 24 * 3600 * 1000;

let admin; // a plain pg client for DDL, outside the app's pool
let pool;
let planStore;
let entitlements;
let subscriptionUpdate;
let normalizeNotice;
let schemaName;

const DDL = `
  CREATE TABLE users (
    id serial PRIMARY KEY,
    username text NOT NULL UNIQUE,
    account_type text NOT NULL DEFAULT 'child',
    plan text NOT NULL DEFAULT 'free',
    comped boolean NOT NULL DEFAULT false,
    plan_status text,
    stripe_subscription_id text,
    plan_renews_at timestamptz,
    plan_cancel_at_period_end boolean NOT NULL DEFAULT false,
    app_account_token text
  );
  CREATE UNIQUE INDEX idx_users_app_account_token ON users (app_account_token) WHERE app_account_token IS NOT NULL;
  CREATE TABLE parent_child_links (
    parent_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, child_id)
  );
  CREATE TABLE classrooms (
    id serial PRIMARY KEY,
    teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    join_code text NOT NULL UNIQUE
  );
  CREATE TABLE classroom_members (
    classroom_id integer NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    child_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (classroom_id, child_id)
  );
  CREATE TABLE app_store_subscriptions (
    id serial PRIMARY KEY,
    user_id integer REFERENCES users(id) ON DELETE SET NULL,
    original_transaction_id text NOT NULL,
    in_app_ownership_type text NOT NULL DEFAULT 'PURCHASED',
    app_account_token text,
    product_id text,
    plan text,
    environment text NOT NULL,
    status text NOT NULL,
    expires_at timestamptz,
    grace_period_expires_at timestamptz,
    auto_renew boolean,
    last_notification_type text,
    last_subtype text,
    last_signed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX app_store_subscriptions_original_tx_unique
    ON app_store_subscriptions (original_transaction_id, in_app_ownership_type);
  CREATE TABLE app_store_notifications (
    id serial PRIMARY KEY,
    notification_uuid text NOT NULL,
    notification_type text NOT NULL,
    subtype text,
    original_transaction_id text,
    environment text,
    signed_at timestamptz,
    outcome text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX app_store_notifications_uuid_unique ON app_store_notifications (notification_uuid);
`;

const planForProductId = id => (id === 'premium.monthly' ? 'premium' : null);
const decide = (existing, notice, opts) => subscriptionUpdate(existing, notice, { ...opts, planForProductId });

function notice(type, { uuid, signedAt = Date.now(), token = null, expiresIn = 30 * DAY, ownership = 'PURCHASED', subtype } = {}) {
  return normalizeNotice({
    notification: {
      notificationUUID: uuid || `uuid-${Math.random()}`,
      notificationType: type,
      subtype,
      signedDate: signedAt,
      data: { environment: 'Sandbox' },
    },
    transaction: {
      originalTransactionId: 'otx-1',
      inAppOwnershipType: ownership,
      productId: 'premium.monthly',
      appAccountToken: token,
      expiresDate: signedAt + expiresIn,
    },
  });
}

async function insertUser(username, fields = {}) {
  const cols = ['username', ...Object.keys(fields)];
  const vals = [username, ...Object.values(fields)];
  const { rows } = await admin.query(
    `INSERT INTO "${schemaName}".users (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    vals,
  );
  return rows[0].id;
}

const count = async table => (await admin.query(`SELECT COUNT(*)::int AS n FROM "${schemaName}".${table}`)).rows[0].n;

suite('planStore against a real Postgres', () => {
  beforeAll(async () => {
    const { Client } = require('pg');
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    schemaName = `plan_store_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    await admin.query(DDL);

    const url = new URL(TEST_URL);
    url.searchParams.set('options', `-c search_path=${schemaName}`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-signing-secret-not-used-to-verify-anything';
    ({ pool } = require('../db.js'));
    planStore = require('./planStore.js');
    entitlements = require('./entitlements.js');
    ({ subscriptionUpdate, normalizeNotice } = require('./appStoreNotifications.js'));
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE users, parent_child_links, classrooms, classroom_members,
      app_store_subscriptions, app_store_notifications RESTART IDENTITY CASCADE`);
  });

  it('mints one appAccountToken per adult and keeps it, even under concurrent first calls', async () => {
    const id = await insertUser('grownup', { account_type: 'parent' });
    const tokens = await Promise.all([1, 2, 3, 4].map(() => planStore.appAccountTokenFor(id)));
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await planStore.appAccountTokenFor(id)).toBe(tokens[0]);
  });

  it('applies a notification, linking it to the adult its token names', async () => {
    const id = await insertUser('grownup', { account_type: 'parent' });
    const token = await planStore.appAccountTokenFor(id);
    expect(await planStore.processNotification(notice('SUBSCRIBED', { token }), decide)).toEqual({ outcome: 'applied' });

    const [row] = await planStore.appStoreRowsForUsers([id]);
    expect(row).toMatchObject({ userId: id, status: 'active', plan: 'premium', environment: 'Sandbox' });
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(await entitlements.planForUser(id)).toBe('premium');
  });

  it('acknowledges a redelivered notificationUUID without applying it again', async () => {
    const id = await insertUser('grownup', { account_type: 'parent' });
    const token = await planStore.appAccountTokenFor(id);
    await planStore.processNotification(notice('SUBSCRIBED', { token, signedAt: Date.now() - 2 * DAY }), decide);
    const expired = notice('EXPIRED', { uuid: 'expired-1', token, signedAt: Date.now() - DAY, expiresIn: -1 });
    await planStore.processNotification(expired, decide);
    await planStore.processNotification(notice('SUBSCRIBED', { token, subtype: 'RESUBSCRIBE' }), decide);

    const results = await Promise.all([1, 2].map(() => planStore.processNotification(expired, decide)));
    expect(results).toEqual([{ outcome: 'duplicate' }, { outcome: 'duplicate' }]);
    expect(await count('app_store_notifications')).toBe(3);
    expect(await entitlements.planForUser(id)).toBe('premium');
  });

  it('rolls back the idempotency row when applying fails, so a retry is processed', async () => {
    const id = await insertUser('grownup', { account_type: 'parent' });
    const token = await planStore.appAccountTokenFor(id);
    const n = notice('SUBSCRIBED', { uuid: 'flaky', token });
    await expect(planStore.processNotification(n, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await count('app_store_notifications')).toBe(0);

    expect(await planStore.processNotification(n, decide)).toEqual({ outcome: 'applied' });
    expect(await entitlements.planForUser(id)).toBe('premium');
  });

  it('never overwrites newer state with an older signedDate, even when the caller says apply', async () => {
    await planStore.processNotification(notice('SUBSCRIBED', { signedAt: Date.now() }), decide);
    // A decide that ignores staleness, as if two first-sight notifications raced
    // and this one read "no row" before the other committed.
    const older = notice('EXPIRED', { signedAt: Date.now() - DAY, expiresIn: -1 });
    await planStore.processNotification(older, (_existing, n, opts) => subscriptionUpdate(null, n, { ...opts, planForProductId }));
    const { rows } = await admin.query(`SELECT status FROM "${schemaName}".app_store_subscriptions`);
    expect(rows).toEqual([{ status: 'active' }]);
  });

  it('keeps purchaser and Family Sharing copies of one subscription apart', async () => {
    await planStore.processNotification(notice('SUBSCRIBED'), decide);
    await planStore.processNotification(notice('SUBSCRIBED', { ownership: 'FAMILY_SHARED' }), decide);
    await planStore.processNotification(notice('REVOKE', { ownership: 'FAMILY_SHARED' }), decide);
    const { rows } = await admin.query(
      `SELECT in_app_ownership_type, status FROM "${schemaName}".app_store_subscriptions ORDER BY in_app_ownership_type`);
    expect(rows).toEqual([
      { in_app_ownership_type: 'FAMILY_SHARED', status: 'revoked' },
      { in_app_ownership_type: 'PURCHASED', status: 'active' },
    ]);
  });

  it("does not link a subscription to a child's account", async () => {
    await insertUser('kid', { account_type: 'child', app_account_token: '11111111-1111-4111-8111-111111111111' });
    await planStore.processNotification(notice('SUBSCRIBED', { token: '11111111-1111-4111-8111-111111111111' }), decide);
    const { rows } = await admin.query(`SELECT user_id FROM "${schemaName}".app_store_subscriptions`);
    expect(rows).toEqual([{ user_id: null }]);
  });

  it("resolves a child's plan from parents and classroom teachers in the database", async () => {
    const parent = await insertUser('grownup', { account_type: 'parent' });
    const teacher = await insertUser('teacher', {
      account_type: 'parent', plan: 'classroom', plan_status: 'active', stripe_subscription_id: 'sub_1',
    });
    const child = await insertUser('kid', { account_type: 'child' });
    await admin.query(`INSERT INTO "${schemaName}".parent_child_links (parent_id, child_id) VALUES ($1, $2)`, [parent, child]);
    const token = await planStore.appAccountTokenFor(parent);
    await planStore.processNotification(notice('SUBSCRIBED', { token }), decide);

    expect(await planStore.guardiansOfChild(child)).toEqual({ parentIds: [parent], teacherIds: [] });
    expect(await entitlements.planStatusForChild(child)).toMatchObject({ plan: 'premium', source: 'app_store' });

    const { rows } = await admin.query(
      `INSERT INTO "${schemaName}".classrooms (teacher_id, name, join_code) VALUES ($1, 'Owls', 'OWL123') RETURNING id`, [teacher]);
    await admin.query(`INSERT INTO "${schemaName}".classroom_members (classroom_id, child_id) VALUES ($1, $2)`, [rows[0].id, child]);
    expect(await entitlements.planStatusForChild(child)).toMatchObject({ plan: 'classroom', source: 'classroom' });

    const accounts = await planStore.accountPlanRows([teacher]);
    expect(accounts).toEqual([expect.objectContaining({ id: teacher, plan: 'classroom', stripeSubscriptionId: 'sub_1' })]);
  });
});
