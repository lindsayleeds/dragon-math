// Central source of truth for monetization gating (Phase 1).
//
// Plans live on adult `users` rows (`users.plan`): 'free' | 'premium' | 'classroom'.
// Kids don't hold a plan — a child's access is derived from the highest-ranked
// plan among their guardians (linked parents + classroom teachers). See
// `effectivePlanForUser`.
//
// Plan is deliberately NOT carried in the JWT (30-day tokens would go stale on
// upgrade); always read it from the DB via these helpers, keyed by user id.

const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');

const PLAN_RANK = { free: 0, premium: 1, classroom: 2 };
const CHILD_LIMIT = { free: 1, premium: 6, classroom: Infinity };
const PAID_PLANS = ['premium', 'classroom'];

// Length of the free trial granted on a new paid subscription. ONE constant on
// purpose: it is read both by the Checkout session that actually creates the
// trial and by the disclosure copy the upgrade modal shows, so what a parent is
// promised and when their card is charged can never disagree. Changing the trial
// length is this line (plus docs/PRICING_STRATEGY.md decision 2).
const TRIAL_PERIOD_DAYS = 14;

// Stripe billing (Phase 2). Map each (plan, interval) to its Stripe Price ID,
// read from env so the same code works across test/live and price changes. The
// billing webhook uses the reverse map to resolve a subscription's price back to
// a plan. Kept here so plan config lives in one place (see docs/MONETIZATION.md).
const PLAN_PRICES = {
  premium: {
    month: process.env.STRIPE_PRICE_PREMIUM_MONTHLY || null,
    year: process.env.STRIPE_PRICE_PREMIUM_YEARLY || null,
  },
  classroom: {
    month: process.env.STRIPE_PRICE_CLASSROOM_MONTHLY || null,
    year: process.env.STRIPE_PRICE_CLASSROOM_YEARLY || null,
  },
};

// Legacy (archived) Stripe Price IDs -> plan. When we reprice, the old Price is
// archived in Stripe and env points at the new one — but grandfathered
// subscribers keep billing on the old Price forever, and their renewal webhooks
// still carry the old id. Without this map planForPriceId() would return null
// for them and applySubscription() would downgrade a paying customer to 'free'.
// Stripe Price IDs are permanent and non-secret, so pin them here. Append (never
// remove) an entry each time a Price is archived.
const LEGACY_PRICE_PLANS = {
  // Only the old Premium monthly was ever used in a transaction (1 active sub),
  // so it had to be archived and replaced with a new Price. The other original
  // Prices were unused, so their amounts were edited in place (same id, now the
  // current active Prices) — they don't belong here.
  price_1Tv61OLgnjSpAXxNpzIHlfRE: 'premium', // $2.99/mo — archived 2026-07-20, grandfathered subs
};

// (plan, interval) -> Stripe Price ID, or null if unconfigured/invalid.
function priceIdFor(plan, interval) {
  const norm = interval === 'year' || interval === 'yearly' ? 'year' : 'month';
  return PLAN_PRICES[plan]?.[norm] || null;
}

// Stripe Price ID -> plan value ('premium' | 'classroom'), or null if unknown.
// Checks the current (env) prices first, then legacy/archived prices so
// grandfathered subscribers keep their plan on renewal.
function planForPriceId(priceId) {
  if (!priceId) return null;
  for (const [plan, intervals] of Object.entries(PLAN_PRICES)) {
    if (Object.values(intervals).includes(priceId)) return plan;
  }
  return LEGACY_PRICE_PLANS[priceId] || null;
}

// Games (by id, see src/data/games.js) that require a paid plan.
const PAID_GAME_IDS = ['dragon-munchers', 'dragon-spelling', 'proving-grounds'];

function planRank(plan) {
  return PLAN_RANK[plan] ?? 0;
}

// The plan a "lifetime free" comp grants by default, keyed off adult role:
// teachers need unlimited students (classroom), guardians get premium. An admin
// can still override to a specific paid plan; this is only the auto default.
function compPlanForRole(adultRole) {
  return adultRole === 'teacher' ? 'classroom' : 'premium';
}

function childLimit(plan) {
  return CHILD_LIMIT[plan] ?? CHILD_LIMIT.free;
}

function isPaid(plan) {
  return planRank(plan) > 0;
}

function canUseDigest(plan) {
  return isPaid(plan);
}

function isGameLocked(gameId, plan) {
  return PAID_GAME_IDS.includes(gameId) && !isPaid(plan);
}

// The games locked for a given plan — handy to surface to the client.
function lockedGames(plan) {
  return isPaid(plan) ? [] : [...PAID_GAME_IDS];
}

// The adult's own stored plan (defaults to 'free' if the row is missing).
async function planForUser(userId) {
  const [row] = await db
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.plan || 'free';
}

// A child's effective plan = the highest-ranked plan across all guardians:
// linked parents (parent_child_links) and classroom teachers
// (classroom_members -> classrooms.teacher_id). Returns 'free' if unguarded.
async function effectivePlanForChild(childId) {
  const guardianPlans = await db
    .select({ plan: schema.users.plan })
    .from(schema.parentChildLinks)
    .innerJoin(schema.users, eq(schema.users.id, schema.parentChildLinks.parentId))
    .where(eq(schema.parentChildLinks.childId, childId));

  const teacherPlans = await db
    .select({ plan: schema.users.plan })
    .from(schema.classroomMembers)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.classroomMembers.classroomId))
    .innerJoin(schema.users, eq(schema.users.id, schema.classrooms.teacherId))
    .where(eq(schema.classroomMembers.childId, childId));

  const plans = [...guardianPlans, ...teacherPlans].map((r) => r.plan || 'free');
  return plans.reduce((best, p) => (planRank(p) > planRank(best) ? p : best), 'free');
}

// Resolve the effective plan for any user: adults use their own plan, children
// derive it from their guardians. Pass the loaded `req.user` (has account_type).
async function effectivePlanForUser(user) {
  if (!user) return 'free';
  if (user.account_type === 'child') return effectivePlanForChild(user.id);
  return planForUser(user.id);
}

// Count how many children an adult "owns" for the child-limit ladder:
// parents count parent_child_links; teachers count distinct students across
// their classrooms.
async function childCountForAdult(userId, adultRole) {
  if (adultRole === 'teacher') {
    const [{ count }] = await db
      .select({ count: sql`COUNT(DISTINCT ${schema.classroomMembers.childId})::int`.as('count') })
      .from(schema.classroomMembers)
      .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.classroomMembers.classroomId))
      .where(eq(schema.classrooms.teacherId, userId));
    return count;
  }
  const [{ count }] = await db
    .select({ count: sql`COUNT(*)::int`.as('count') })
    .from(schema.parentChildLinks)
    .where(eq(schema.parentChildLinks.parentId, userId));
  return count;
}

module.exports = {
  PLAN_RANK,
  CHILD_LIMIT,
  PAID_PLANS,
  PAID_GAME_IDS,
  TRIAL_PERIOD_DAYS,
  PLAN_PRICES,
  planRank,
  compPlanForRole,
  childLimit,
  isPaid,
  canUseDigest,
  isGameLocked,
  lockedGames,
  priceIdFor,
  planForPriceId,
  planForUser,
  effectivePlanForChild,
  effectivePlanForUser,
  childCountForAdult,
};
