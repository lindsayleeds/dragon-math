// Test-only helpers for App Store Server Notifications — the server never loads
// this file. No network and no Apple credentials: each kit generates its own
// root -> intermediate -> leaf chain (EC P-256, carrying the marker extensions
// Apple's library requires on the intermediate and leaf) and signs JWSs with
// the leaf, exactly as Apple does. A verifier trusting the kit's root accepts
// them; one trusting the real Apple Root CA G3 rejects them.
//
// Also an in-memory planStore (same methods as ./planStore.js) so route tests
// can drive notifications and plan status without Postgres.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { KJUR } = require('jsrsasign');

// Marker OIDs @apple/app-store-server-library checks for on the chain.
const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';
const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
const DER_NULL = '0500';

function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKey,
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function certificate({ serial, subject, issuer, publicPem, signerPem, ca, oid }) {
  const ext = [{ extname: 'basicConstraints', cA: ca, critical: true }];
  if (oid) ext.push({ extname: oid, extn: DER_NULL });
  return new KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: serial },
    issuer: { str: issuer },
    subject: { str: subject },
    notbefore: '200101000000Z',
    notafter: '20991231235959Z',
    sbjpubkey: publicPem,
    sigalg: 'SHA256withECDSA',
    cakey: signerPem,
    ext,
  }).getPEM();
}

// A self-contained signing chain. `config` is an appStoreConfig()-shaped object
// matching the payloads the kit builds.
function createAppStoreTestKit({ bundleId = 'dev.test.dragonacademy', environment = 'Sandbox' } = {}) {
  const root = keyPair();
  const intermediate = keyPair();
  const leaf = keyPair();
  const rootPem = certificate({
    serial: 1, subject: '/CN=Test Root CA', issuer: '/CN=Test Root CA',
    publicPem: root.publicPem, signerPem: root.privatePem, ca: true,
  });
  const intermediatePem = certificate({
    serial: 2, subject: '/CN=Test Intermediate', issuer: '/CN=Test Root CA',
    publicPem: intermediate.publicPem, signerPem: root.privatePem, ca: true, oid: APPLE_INTERMEDIATE_OID,
  });
  const leafPem = certificate({
    serial: 3, subject: '/CN=Test Leaf', issuer: '/CN=Test Intermediate',
    publicPem: leaf.publicPem, signerPem: intermediate.privatePem, ca: false, oid: APPLE_LEAF_OID,
  });
  const der = pem => new crypto.X509Certificate(pem).raw.toString('base64');
  const x5c = [der(leafPem), der(intermediatePem), der(rootPem)];

  const sign = payload => jwt.sign(payload, leaf.privateKey, { algorithm: 'ES256', header: { alg: 'ES256', x5c } });

  // -> a signedPayload for one notification. `transaction` / `renewal` fields
  // override the defaults; pass `transaction: null` for a summary-style
  // notification with no transaction.
  function notification({
    type,
    subtype,
    uuid = crypto.randomUUID(),
    signedAt = Date.now(),
    transaction = {},
    renewal,
    payloadBundleId = bundleId,
    payloadEnvironment = environment,
  }) {
    const data = { bundleId: payloadBundleId, environment: payloadEnvironment };
    if (transaction) {
      data.signedTransactionInfo = sign({
        originalTransactionId: '2000000000000001',
        transactionId: `${signedAt}`,
        bundleId: payloadBundleId,
        productId: 'premium.monthly',
        purchaseDate: signedAt,
        expiresDate: signedAt + 30 * 24 * 3600 * 1000,
        type: 'Auto-Renewable Subscription',
        inAppOwnershipType: 'PURCHASED',
        environment: payloadEnvironment,
        signedDate: signedAt,
        ...transaction,
      });
    }
    if (renewal) {
      data.signedRenewalInfo = sign({
        originalTransactionId: transaction?.originalTransactionId || '2000000000000001',
        autoRenewProductId: 'premium.monthly',
        productId: 'premium.monthly',
        autoRenewStatus: 1,
        environment: payloadEnvironment,
        signedDate: signedAt,
        ...renewal,
      });
    }
    const body = { notificationType: type, notificationUUID: uuid, version: '2.0', signedDate: signedAt, data };
    if (subtype) body.subtype = subtype;
    return sign(body);
  }

  return {
    rootCertificate: Buffer.from(rootPem),
    config: { bundleId, environment, appAppleId: undefined, onlineChecks: false },
    sign,
    notification,
  };
}

// In-memory stand-in for ./planStore.js. `state` is exposed so a test can seed
// users/links and inspect subscriptions and notifications.
function createMemoryPlanStore() {
  const state = {
    users: new Map(), // id -> { id, accountType, plan, comped, planStatus, stripeSubscriptionId, planRenewsAt, planCancelAtPeriodEnd, appAccountToken }
    parentLinks: [], // { parentId, childId }
    classroomMembers: [], // { teacherId, childId }
    subscriptions: [], // app_store_subscriptions rows
    notifications: new Map(), // uuid -> outcome
  };

  function addUser(row) {
    const user = {
      accountType: 'parent', plan: 'free', comped: false, planStatus: null, stripeSubscriptionId: null,
      planRenewsAt: null, planCancelAtPeriodEnd: false, appAccountToken: null, ...row,
    };
    state.users.set(user.id, user);
    return user;
  }

  return {
    state,
    addUser,
    async accountPlanRows(ids) {
      return ids.map(id => state.users.get(id)).filter(Boolean).map(u => ({ ...u }));
    },
    async appStoreRowsForUsers(ids) {
      return state.subscriptions.filter(r => ids.includes(r.userId)).map(r => ({ ...r }));
    },
    async guardiansOfChild(childId) {
      return {
        parentIds: state.parentLinks.filter(l => l.childId === childId).map(l => l.parentId),
        teacherIds: state.classroomMembers.filter(m => m.childId === childId).map(m => m.teacherId),
      };
    },
    async appAccountTokenFor(userId) {
      const user = state.users.get(userId);
      if (!user) return null;
      if (!user.appAccountToken) user.appAccountToken = crypto.randomUUID();
      return user.appAccountToken;
    },
    async processNotification(notice, decide) {
      if (state.notifications.has(notice.notificationUUID)) return { outcome: 'duplicate' };
      const t = notice.transaction;
      const index = t
        ? state.subscriptions.findIndex(r =>
          r.originalTransactionId === t.originalTransactionId && r.inAppOwnershipType === t.inAppOwnershipType)
        : -1;
      const existing = index >= 0 ? { ...state.subscriptions[index] } : null;
      let linkedUserId = null;
      if (!existing?.userId && t?.appAccountToken) {
        const owner = [...state.users.values()].find(u => u.appAccountToken === t.appAccountToken && u.accountType !== 'child');
        linkedUserId = owner?.id ?? null;
      }
      const result = decide(existing, notice, { linkedUserId });
      if (result.outcome === 'applied') {
        if (index >= 0) state.subscriptions[index] = { ...existing, ...result.row };
        else state.subscriptions.push({ id: state.subscriptions.length + 1, ...result.row });
      }
      state.notifications.set(notice.notificationUUID, result.outcome);
      return { outcome: result.outcome };
    },
  };
}

module.exports = { createAppStoreTestKit, createMemoryPlanStore };
