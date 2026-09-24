// The notification -> subscription rules (./appStoreNotifications.js) for the
// cases the route tests (server/routes/appStore.test.js) reach only indirectly.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STATUS, handledTypes, normalizeNotice, subscriptionUpdate, appStoreGrant } = require('./appStoreNotifications.js');

const T0 = Date.parse('2026-09-01T00:00:00Z');
const DAY = 24 * 3600 * 1000;
const planForProductId = id => (id === 'premium.monthly' ? 'premium' : null);

function notice(type, { subtype, signedAt = T0, transaction = {}, renewalInfo } = {}) {
  return normalizeNotice({
    notification: { notificationUUID: 'u', notificationType: type, subtype, signedDate: signedAt, data: { environment: 'Sandbox' } },
    transaction: transaction && {
      originalTransactionId: '1', productId: 'premium.monthly', expiresDate: signedAt + 30 * DAY, ...transaction,
    },
    renewalInfo,
  });
}

describe('subscriptionUpdate', () => {
  it('handles at least the notification types the plan depends on', () => {
    expect(handledTypes()).toEqual(expect.arrayContaining([
      'SUBSCRIBED', 'DID_RENEW', 'EXPIRED', 'DID_FAIL_TO_RENEW', 'REFUND', 'REVOKE', 'DID_CHANGE_RENEWAL_STATUS',
    ]));
  });

  it('keeps an existing link even when the token no longer resolves', () => {
    const existing = { userId: 5, status: STATUS.ACTIVE, lastSignedAt: new Date(T0 - DAY) };
    const { row } = subscriptionUpdate(existing, notice('DID_RENEW'), { linkedUserId: null, planForProductId });
    expect(row.userId).toBe(5);
  });

  it('infers status from the dates when a renewal-status change is the first thing seen', () => {
    const live = subscriptionUpdate(null, notice('DID_CHANGE_RENEWAL_STATUS'), { planForProductId });
    expect(live.row.status).toBe(STATUS.ACTIVE);
    const lapsed = subscriptionUpdate(null, notice('DID_CHANGE_RENEWAL_STATUS', { transaction: { expiresDate: T0 - DAY } }), { planForProductId });
    expect(lapsed.row.status).toBe(STATUS.EXPIRED);
  });

  it('ignores a notification with no transaction', () => {
    expect(subscriptionUpdate(null, notice('SUBSCRIBED', { transaction: null }), { planForProductId })).toEqual({ outcome: 'ignored' });
  });

  it('applies a notification signed at the same instant as the stored one', () => {
    const existing = { userId: 5, status: STATUS.ACTIVE, lastSignedAt: new Date(T0) };
    expect(subscriptionUpdate(existing, notice('EXPIRED'), { planForProductId }).outcome).toBe('applied');
  });
});

describe('appStoreGrant', () => {
  const row = { userId: 1, plan: 'premium', status: STATUS.ACTIVE, expiresAt: new Date(T0 + DAY), autoRenew: true };

  it('grants until expiresAt, then nothing', () => {
    expect(appStoreGrant(row, new Date(T0))).toMatchObject({ source: 'app_store', plan: 'premium', will_renew: true });
    expect(appStoreGrant(row, new Date(T0 + DAY))).toBeNull();
  });

  it('grants through a grace period only until it ends', () => {
    const grace = { ...row, status: STATUS.GRACE_PERIOD, expiresAt: new Date(T0 - DAY), gracePeriodExpiresAt: new Date(T0 + DAY) };
    expect(appStoreGrant(grace, new Date(T0))?.plan).toBe('premium');
    expect(appStoreGrant(grace, new Date(T0 + 2 * DAY))).toBeNull();
  });

  it('never grants for billing retry, expiry, refund, revocation, no owner or no plan', () => {
    for (const status of [STATUS.BILLING_RETRY, STATUS.EXPIRED, STATUS.REFUNDED, STATUS.REVOKED]) {
      expect(appStoreGrant({ ...row, status }, new Date(T0))).toBeNull();
    }
    expect(appStoreGrant({ ...row, userId: null }, new Date(T0))).toBeNull();
    expect(appStoreGrant({ ...row, plan: null }, new Date(T0))).toBeNull();
  });
});
