// App Store Server Notifications V2 (ADR 0008). Apple POSTs
// `{ signedPayload }` here whenever an in-app subscription changes; the payload
// is verified against Apple's root CA (server/lib/appStoreVerifier.js), turned
// into subscription state (server/lib/appStoreNotifications.js) and stored,
// exactly once per notificationUUID (server/lib/planStore.js). Plan checks then
// see it through the resolver in server/lib/entitlements.js.
//
// Public on purpose, like the Stripe webhook: the JWS signature is the
// authentication. Unlike the Stripe webhook, a failure to APPLY is answered with
// a 5xx — Apple redelivers until it gets a 200 (for up to a few days), and the
// notificationUUID guard makes the redelivery safe, so a retry is the recovery.
// A payload that fails verification gets a 400: it did not come from Apple.
//
// Operator setup (App Store Connect URL, env) is in docs/APP_STORE.md.
const express = require('express');
const { z } = require('zod');
const { parseInput } = require('../lib/parseInput');
const planStore = require('../lib/planStore');
const { planForAppStoreProductId } = require('../lib/entitlements');
const { subscriptionUpdate } = require('../lib/appStoreNotifications');
const {
  appStoreConfig,
  createNotificationVerifier,
  NotificationRejected,
} = require('../lib/appStoreVerifier');

const NotificationRequest = z.object({
  signedPayload: z.string({ error: 'signedPayload is required' }).min(1, { error: 'signedPayload is required' }),
});

// `verifier` null = not configured (503). `store` and `planForProductId` are
// seams for tests; production uses planStore and the env product map.
function createAppStoreRouter({ verifier, store = planStore, planForProductId = planForAppStoreProductId }) {
  const router = express.Router();

  router.post('/notifications', async (req, res) => {
    if (!verifier) return res.status(503).json({ error: 'App Store notifications are not configured.' });

    const input = parseInput(NotificationRequest, req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });

    let notice;
    try {
      notice = await verifier.decode(input.data.signedPayload);
    } catch (err) {
      if (err instanceof NotificationRejected) {
        console.warn(`App Store notification rejected: ${err.message}`);
        return err.retryable
          ? res.status(503).json({ error: 'Could not verify the notification yet.' })
          : res.status(400).json({ error: 'Invalid signedPayload.' });
      }
      console.error('App Store notification could not be decoded:', err);
      return res.status(500).json({ error: 'Could not process the notification.' });
    }

    try {
      const { outcome } = await store.processNotification(notice, (existing, n, opts) =>
        subscriptionUpdate(existing, n, { ...opts, planForProductId }),
      );
      console.log(
        `App Store notification ${notice.notificationUUID} ${notice.notificationType}` +
          `${notice.subtype ? `/${notice.subtype}` : ''} -> ${outcome}`,
      );
      res.json({ received: true, outcome });
    } catch (err) {
      console.error(`Error applying App Store notification ${notice.notificationUUID}:`, err);
      res.status(500).json({ error: 'Could not process the notification.' });
    }
  });

  return router;
}

function defaultVerifier() {
  const config = appStoreConfig();
  if (config.error) {
    // Dormant until configured, like Stripe billing. Only a half-done setup is
    // worth a line in the log.
    if (process.env.APPSTORE_BUNDLE_ID) console.warn(`App Store notifications disabled: ${config.error}`);
    return null;
  }
  return createNotificationVerifier(config);
}

module.exports = createAppStoreRouter({ verifier: defaultVerifier() });
module.exports.createAppStoreRouter = createAppStoreRouter;
