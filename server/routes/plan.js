// GET /api/plan/status — one plan status per family (ADR 0008), for the web and
// the iOS app alike. The answer is planStatusForUser() from
// server/lib/entitlements.js, the same resolver every plan gate uses, so what
// this reports and what the server enforces cannot disagree. Contract:
// server/contracts/plan.js.
//
// ?child_id= reports a linked kid's plan instead (the best among all their
// guardians, classroom teachers included): the iOS app on a family iPad has
// the parent's session for every kid, and gates each kid's games on their own
// plan.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const planStore = require('../lib/planStore');
const { planStatusForUser, planStatusForChild, lockedGames, childLimit, canUseDigest } = require('../lib/entitlements');
const { parseInput } = require('../lib/parseInput');
const { PlanStatusQuery } = require('../contracts/plan');

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

// Whether this caller may read that child's plan: a child only their own, an
// adult only a child linked to them (the rule of server/lib/childAccess.js,
// read through planStore so it is the same guardian list the plan comes from).
async function mayReadChildPlan(user, childId) {
  if (user.account_type === 'child') return childId === user.id;
  const { parentIds } = await planStore.guardiansOfChild(childId);
  return parentIds.includes(user.id);
}

router.get('/status', requireAuth, async (req, res) => {
  const query = parseInput(PlanStatusQuery, req.query);
  if (!query.ok) return res.status(400).json({ error: query.error });
  const childId = query.data.child_id ?? null;
  try {
    if (childId !== null && !(await mayReadChildPlan(req.user, childId))) {
      return res.status(403).json({ error: 'Not your child' });
    }
    const status = childId !== null ? await planStatusForChild(childId) : await planStatusForUser(req.user);
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
