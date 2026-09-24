// App Store Server Notifications V2 -> subscription state (ADR 0008). Pure: no
// DB, no Apple library, no clock of its own. server/routes/appStore.js verifies
// and decodes the signed payload, server/lib/planStore.js loads and saves the
// row, and this module decides what the row becomes.
//
// A notice (see normalizeNotice) is the decoded notification plus its decoded
// transaction and renewal info. The row is keyed by the transaction's
// (originalTransactionId, inAppOwnershipType) — see app_store_subscriptions in
// server/db/schema.js.
//
// Status is taken from the notification TYPE, because that is what Apple uses
// to say what happened, and dates from the transaction and renewal info. Whether
// a row grants its plan is then decided at read time (appStoreGrant) against the
// clock, so a missed EXPIRED notification still lets access lapse at expiresAt.

// Statuses a row can be in. Only ACTIVE and GRACE_PERIOD grant access.
const STATUS = Object.freeze({
  ACTIVE: 'active',
  // Renewal failed but Apple's Billing Grace Period is on: keep access until
  // gracePeriodExpiresAt while Apple retries the charge.
  GRACE_PERIOD: 'grace_period',
  // Renewal failed with no (or an ended) grace period: Apple keeps retrying for
  // up to 60 days, but the customer is not entitled meanwhile. A DID_RENEW with
  // subtype BILLING_RECOVERY brings the row back to ACTIVE.
  BILLING_RETRY: 'billing_retry',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
  // A Family Sharing member lost access (the purchaser stopped sharing, or the
  // purchase was refunded).
  REVOKED: 'revoked',
});

// notificationType -> status it sets. A function when the subtype matters;
// KEEP means "this notification changes renewal details, not entitlement".
const KEEP = Symbol('keep');
const STATUS_FOR_TYPE = {
  SUBSCRIBED: STATUS.ACTIVE, // INITIAL_BUY | RESUBSCRIBE
  DID_RENEW: STATUS.ACTIVE, // incl. BILLING_RECOVERY
  OFFER_REDEEMED: STATUS.ACTIVE,
  RENEWAL_EXTENDED: STATUS.ACTIVE,
  REFUND_REVERSED: STATUS.ACTIVE,
  DID_FAIL_TO_RENEW: subtype => (subtype === 'GRACE_PERIOD' ? STATUS.GRACE_PERIOD : STATUS.BILLING_RETRY),
  GRACE_PERIOD_EXPIRED: STATUS.BILLING_RETRY,
  EXPIRED: STATUS.EXPIRED,
  REFUND: STATUS.REFUNDED,
  REVOKE: STATUS.REVOKED,
  DID_CHANGE_RENEWAL_STATUS: KEEP, // AUTO_RENEW_ENABLED | AUTO_RENEW_DISABLED
  DID_CHANGE_RENEWAL_PREF: KEEP, // upgrade/downgrade takes effect at next renewal
  PRICE_INCREASE: KEEP,
};

function handledTypes() {
  return Object.keys(STATUS_FOR_TYPE);
}

// Apple sends dates as epoch milliseconds.
function toDate(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms) : null;
}

// The decoded notification + its decoded transaction/renewal info -> the plain
// object the rest of this module and the store work with. Everything Apple sends
// that we act on is named here, so a field rename is one edit.
function normalizeNotice({ notification, transaction = null, renewalInfo = null }) {
  return {
    notificationUUID: notification.notificationUUID,
    notificationType: notification.notificationType,
    subtype: notification.subtype || null,
    signedAt: toDate(notification.signedDate),
    environment: notification.data?.environment || transaction?.environment || null,
    transaction: transaction && {
      originalTransactionId: transaction.originalTransactionId,
      inAppOwnershipType: transaction.inAppOwnershipType || 'PURCHASED',
      productId: transaction.productId || null,
      // StoreKit sends the token lowercased or not depending on the client; the
      // column holds crypto.randomUUID()'s lowercase form.
      appAccountToken: transaction.appAccountToken ? String(transaction.appAccountToken).toLowerCase() : null,
      expiresAt: toDate(transaction.expiresDate),
      revokedAt: toDate(transaction.revocationDate),
    },
    renewalInfo: renewalInfo && {
      autoRenew: renewalInfo.autoRenewStatus === undefined ? null : renewalInfo.autoRenewStatus === 1,
      gracePeriodExpiresAt: toDate(renewalInfo.gracePeriodExpiresDate),
    },
  };
}

// What to do with `notice` given the stored row (`existing`, or null for a
// subscription we have not seen). Returns one of:
//   { outcome: 'ignored' }        — nothing to apply (unhandled type, TEST, a
//                                   summary notification with no transaction)
//   { outcome: 'stale' }          — older than the state already stored
//   { outcome: 'applied', row }   — the row to upsert
// `linkedUserId` is the account the transaction's appAccountToken resolved to
// (null if none); an existing link is never overwritten by a failed lookup.
// `planForProductId` maps an App Store product id to a plan (or null).
function subscriptionUpdate(existing, notice, { linkedUserId = null, planForProductId }) {
  const rule = STATUS_FOR_TYPE[notice.notificationType];
  const tx = notice.transaction;
  if (rule === undefined || !tx?.originalTransactionId) return { outcome: 'ignored' };

  if (existing?.lastSignedAt && notice.signedAt && notice.signedAt < existing.lastSignedAt) {
    return { outcome: 'stale' };
  }

  let status;
  if (rule === KEEP) {
    // First sight of this subscription is a renewal-preference change (the
    // SUBSCRIBED notice was lost or arrives later): infer from the dates.
    status = existing?.status
      ?? (tx.expiresAt && notice.signedAt && tx.expiresAt > notice.signedAt ? STATUS.ACTIVE : STATUS.EXPIRED);
  } else {
    status = typeof rule === 'function' ? rule(notice.subtype) : rule;
  }

  const renewal = notice.renewalInfo;
  return {
    outcome: 'applied',
    row: {
      userId: existing?.userId ?? linkedUserId ?? null,
      originalTransactionId: tx.originalTransactionId,
      inAppOwnershipType: tx.inAppOwnershipType,
      appAccountToken: tx.appAccountToken ?? existing?.appAccountToken ?? null,
      productId: tx.productId ?? existing?.productId ?? null,
      plan: planForProductId(tx.productId ?? existing?.productId) || null,
      environment: notice.environment ?? existing?.environment,
      status,
      expiresAt: tx.expiresAt ?? existing?.expiresAt ?? null,
      gracePeriodExpiresAt: status === STATUS.GRACE_PERIOD
        ? (renewal?.gracePeriodExpiresAt ?? existing?.gracePeriodExpiresAt ?? null)
        : null,
      autoRenew: renewal?.autoRenew ?? existing?.autoRenew ?? null,
      lastNotificationType: notice.notificationType,
      lastSubtype: notice.subtype,
      lastSignedAt: notice.signedAt ?? existing?.lastSignedAt ?? new Date(0),
    },
  };
}

// The plan grant a stored row gives at `now`, or null. Only linked rows for a
// product we sell grant anything. This is the single definition of "an App
// Store subscription is entitled" — the plan resolver (server/lib/planStatus.js)
// and so every plan check go through it.
function appStoreGrant(row, now = new Date()) {
  if (!row?.userId || !row.plan) return null;
  let until;
  if (row.status === STATUS.ACTIVE) until = row.expiresAt;
  else if (row.status === STATUS.GRACE_PERIOD) until = row.gracePeriodExpiresAt ?? row.expiresAt;
  else return null;
  if (!until || new Date(until) <= now) return null;
  return {
    source: 'app_store',
    plan: row.plan,
    expires_at: new Date(until),
    will_renew: row.status === STATUS.ACTIVE ? row.autoRenew ?? null : null,
  };
}

module.exports = {
  STATUS,
  handledTypes,
  normalizeNotice,
  subscriptionUpdate,
  appStoreGrant,
};
