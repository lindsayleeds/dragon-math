// GET /api/plan/status — one plan status per family (ADR 0008), for the web and
// the iOS app alike. The answer is planStatusForUser() from
// server/lib/entitlements.js, the same resolver every plan gate uses, so what
// this reports and what the server enforces cannot disagree. Contract:
// server/contracts/plan.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const planStore = require('../lib/planStore');
const { planStatusForUser, lockedGames, childLimit, canUseDigest } = require('../lib/entitlements');

const router = express.Router();

const iso = date => (date ? new Date(date).toISOString() : null);

function grantBody(grant) {
  return {
    source: grant.source,
    plan: grant.plan,
    expires_at: iso(grant.expires_at),
    will_renew: grant.will_renew ?? null,
  };
}

router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await planStatusForUser(req.user);
    // Only a parent buys in the app (behind the parental gate), so only a
    // parent session is handed the token StoreKit credits the purchase to.
    const appAccountToken = req.user.account_type === 'parent'
      ? await planStore.appAccountTokenFor(req.user.id)
      : null;
    const limit = childLimit(status.plan);
    res.set('Cache-Control', 'no-store');
    res.json({
      ...grantBody(status),
      grants: status.grants.map(grantBody),
      entitlements: {
        games_locked: lockedGames(status.plan),
        child_limit: limit === Infinity ? null : limit,
        can_use_digest: canUseDigest(status.plan),
      },
      app_account_token: appAccountToken,
    });
  } catch (err) {
    console.error('Could not resolve plan status:', err);
    res.status(500).json({ error: 'Could not load your plan. Please try again.' });
  }
});

module.exports = router;
