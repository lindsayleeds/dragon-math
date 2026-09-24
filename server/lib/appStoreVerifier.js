// Verifies and decodes App Store Server Notifications V2 (ADR 0008) with Apple's
// own @apple/app-store-server-library. A notification is a JWS whose x5c header
// carries leaf -> intermediate -> root; the library checks that chain against
// the root certificates we pin, checks Apple's marker extensions on the leaf and
// intermediate, verifies the signature, and then checks the bundle id and
// environment. The transaction and renewal info inside are JWSs of their own and
// are verified the same way.
//
// Config (env, see .env.example):
//   APPSTORE_BUNDLE_ID      required; unset = notifications return 503
//   APPSTORE_ENVIRONMENT    'Production' (default) or 'Sandbox'
//   APPSTORE_APP_APPLE_ID   the app's numeric Apple ID; required for Production
//   APPSTORE_ONLINE_CHECKS  'false' to skip OCSP revocation checks (default on)
//
// Only Production and Sandbox are accepted. The library's Xcode and
// LocalTesting environments SKIP signature verification entirely, so allowing
// them here would let anyone POST a hand-written payload and grant a plan.
const fs = require('fs');
const path = require('path');
const { SignedDataVerifier, Environment, VerificationException, VerificationStatus } = require('@apple/app-store-server-library');
const { normalizeNotice } = require('./appStoreNotifications');

// Apple Root CA - G3, which anchors every App Store JWS chain. From
// https://www.apple.com/certificateauthority/; SHA-256 fingerprint
// 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
// (asserted by appStoreVerifier.test.js). Valid until 2039-04-30.
const APPLE_ROOT_CA_G3_PATH = path.join(__dirname, '..', 'certs', 'AppleRootCA-G3.pem');

const ALLOWED_ENVIRONMENTS = [Environment.PRODUCTION, Environment.SANDBOX];

// env -> config, or { error } describing why notifications are disabled.
function appStoreConfig(env = process.env) {
  const bundleId = (env.APPSTORE_BUNDLE_ID || '').trim();
  if (!bundleId) return { error: 'APPSTORE_BUNDLE_ID is not set' };
  const environment = (env.APPSTORE_ENVIRONMENT || Environment.PRODUCTION).trim();
  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    return { error: `APPSTORE_ENVIRONMENT must be ${ALLOWED_ENVIRONMENTS.join(' or ')}` };
  }
  const rawAppId = (env.APPSTORE_APP_APPLE_ID || '').trim();
  const appAppleId = rawAppId ? Number(rawAppId) : undefined;
  if (rawAppId && !Number.isSafeInteger(appAppleId)) return { error: 'APPSTORE_APP_APPLE_ID must be a number' };
  if (environment === Environment.PRODUCTION && appAppleId === undefined) {
    return { error: 'APPSTORE_APP_APPLE_ID is required in Production' };
  }
  return {
    bundleId,
    environment,
    appAppleId,
    onlineChecks: (env.APPSTORE_ONLINE_CHECKS || 'true').trim().toLowerCase() !== 'false',
  };
}

class NotificationRejected extends Error {
  // retryable: the failure was ours or the network's (e.g. OCSP unreachable), so
  // the route answers 5xx and Apple redelivers; otherwise the payload is bad.
  constructor(message, { retryable = false, cause } = {}) {
    super(message, { cause });
    this.retryable = retryable;
  }
}

// -> { decode(signedPayload) -> normalized notice }. `rootCertificates` is an
// array of PEM/DER Buffers; tests pass a locally generated root instead.
function createNotificationVerifier(config, { rootCertificates } = {}) {
  const roots = rootCertificates || [fs.readFileSync(APPLE_ROOT_CA_G3_PATH)];
  const verifier = new SignedDataVerifier(
    roots,
    config.onlineChecks,
    config.environment,
    config.bundleId,
    config.appAppleId,
  );

  async function verify(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof VerificationException) {
        const retryable = err.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
        const name = Object.keys(VerificationStatus).find(k => VerificationStatus[k] === err.status) || err.status;
        throw new NotificationRejected(`App Store payload failed verification (${name})`, { retryable, cause: err });
      }
      throw err;
    }
  }

  return {
    async decode(signedPayload) {
      const notification = await verify(() => verifier.verifyAndDecodeNotification(signedPayload));
      const data = notification.data || {};
      const transaction = data.signedTransactionInfo
        ? await verify(() => verifier.verifyAndDecodeTransaction(data.signedTransactionInfo))
        : null;
      const renewalInfo = data.signedRenewalInfo
        ? await verify(() => verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo))
        : null;
      if (!notification.notificationUUID || !notification.notificationType) {
        throw new NotificationRejected('App Store notification is missing its UUID or type');
      }
      return normalizeNotice({ notification, transaction, renewalInfo });
    },
  };
}

module.exports = {
  APPLE_ROOT_CA_G3_PATH,
  appStoreConfig,
  createNotificationVerifier,
  NotificationRejected,
};
