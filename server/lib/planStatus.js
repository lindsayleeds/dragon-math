// One plan status per family (ADR 0008): Stripe, App Store, comp, admin and
// classroom grants resolved into a single answer. Pure — the grants are loaded
// by server/lib/entitlements.js, which is what every plan check calls, so the
// web and the iOS app are answered by the same function.
//
// A GRANT is { source, plan, expires_at, will_renew }:
//   stripe    — users.plan written by the Stripe webhook (server/routes/billing.js)
//   app_store — an entitled app_store_subscriptions row (appStoreGrant)
//   comp      — a comped ("lifetime free") account's hand-granted users.plan
//   manual    — a plan an admin set by hand (/api/admin/users/:id/plan)
//   classroom — a child's grant through a classroom teacher's plan
//
// The highest-ranked plan wins (PLAN_RANK: classroom > premium > free). The
// source only breaks ties, and only affects what is reported, never access.
const { appStoreGrant } = require('./appStoreNotifications');

const SOURCES = ['stripe', 'app_store', 'comp', 'manual', 'classroom'];
// Tie-break among equal plans: the one the parent can see and manage first.
const SOURCE_PRIORITY = { comp: 0, stripe: 1, app_store: 2, manual: 3, classroom: 4 };

// Stripe statuses that still grant access — the same list applySubscription()
// in server/routes/billing.js writes a paid plan for.
const STRIPE_ACTIVE = ['active', 'trialing', 'past_due'];

// Looked up per call: entitlements.js requires this module, so a top-level
// require of it here would see its exports half-built.
const rank = plan => require('./entitlements').planRank(plan);

// The grant held in an adult's own users row (plan, comped, plan_status,
// stripe_subscription_id, plan_renews_at, plan_cancel_at_period_end), or null.
// users.plan stays exactly what the Stripe webhook and admin tools write; this
// only labels where it came from.
function accountGrant(row) {
  if (!row || rank(row.plan) === 0) return null;
  if (row.comped) return { source: 'comp', plan: row.plan, expires_at: null, will_renew: null };
  if (row.stripeSubscriptionId && STRIPE_ACTIVE.includes(row.planStatus)) {
    return {
      source: 'stripe',
      plan: row.plan,
      expires_at: row.planRenewsAt ? new Date(row.planRenewsAt) : null,
      will_renew: !row.planCancelAtPeriodEnd,
    };
  }
  return { source: 'manual', plan: row.plan, expires_at: null, will_renew: null };
}

// Every grant an adult holds: their users row plus their App Store rows.
function adultGrants(accountRow, appStoreRows = [], now = new Date()) {
  return [accountGrant(accountRow), ...appStoreRows.map(r => appStoreGrant(r, now))].filter(Boolean);
}

function compareGrants(a, b) {
  return rank(b.plan) - rank(a.plan) || SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
}

// grants -> { plan, source, expires_at, will_renew, grants }. `grants` comes
// back sorted best-first; `source` etc. describe grants[0]. No grants = free.
function resolvePlanStatus(grants) {
  const sorted = [...grants].filter(g => rank(g.plan) > 0).sort(compareGrants);
  const best = sorted[0];
  return {
    plan: best?.plan || 'free',
    source: best?.source || null,
    expires_at: best?.expires_at || null,
    will_renew: best?.will_renew ?? null,
    grants: sorted,
  };
}

module.exports = {
  SOURCES,
  STRIPE_ACTIVE,
  accountGrant,
  adultGrants,
  resolvePlanStatus,
};
