// Configuration and trust anchor for App Store notification verification
// (./appStoreVerifier.js). Signature/chain behaviour over HTTP is covered by
// server/routes/appStore.test.js.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { APPLE_ROOT_CA_G3_PATH, appStoreConfig, createNotificationVerifier } = require('./appStoreVerifier.js');
const { createAppStoreTestKit } = require('./appStoreTesting.js');

describe('pinned Apple root', () => {
  it('is Apple Root CA - G3 (fingerprint published at apple.com/certificateauthority)', () => {
    const cert = new crypto.X509Certificate(fs.readFileSync(APPLE_ROOT_CA_G3_PATH));
    expect(cert.subject).toContain('CN=Apple Root CA - G3');
    expect(cert.fingerprint256).toBe(
      '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79',
    );
  });

  it('rejects a payload that is not signed under it', async () => {
    const kit = createAppStoreTestKit();
    const verifier = createNotificationVerifier(kit.config); // default roots: Apple's
    await expect(verifier.decode(kit.notification({ type: 'SUBSCRIBED' }))).rejects.toMatchObject({ retryable: false });
  });
});

describe('appStoreConfig', () => {
  it('is disabled without a bundle id', () => {
    expect(appStoreConfig({})).toEqual({ error: 'APPSTORE_BUNDLE_ID is not set' });
  });

  it('defaults to Production, which needs the app Apple ID', () => {
    expect(appStoreConfig({ APPSTORE_BUNDLE_ID: 'a.b' }).error).toMatch(/APPSTORE_APP_APPLE_ID/);
    expect(appStoreConfig({ APPSTORE_BUNDLE_ID: 'a.b', APPSTORE_APP_APPLE_ID: '1234' })).toEqual({
      bundleId: 'a.b', environment: 'Production', appAppleId: 1234, onlineChecks: true,
    });
  });

  it('accepts Sandbox and an opt-out of online checks', () => {
    expect(appStoreConfig({ APPSTORE_BUNDLE_ID: 'a.b', APPSTORE_ENVIRONMENT: 'Sandbox', APPSTORE_ONLINE_CHECKS: 'false' }))
      .toMatchObject({ environment: 'Sandbox', appAppleId: undefined, onlineChecks: false });
  });

  it('refuses the environments in which Apple\'s library skips signature checks', () => {
    for (const env of ['Xcode', 'LocalTesting', 'sandbox']) {
      expect(appStoreConfig({ APPSTORE_BUNDLE_ID: 'a.b', APPSTORE_ENVIRONMENT: env }).error).toMatch(/Production or Sandbox/);
    }
  });
});
