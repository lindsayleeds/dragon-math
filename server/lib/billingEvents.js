// Funnel instrumentation for the trial (GAPS 6a).
//
// Split deliberately into a pure decision half and a thin write half: deciding
// "was that a conversion?" is the part with the edge cases, and it should be
// testable without a Stripe client or a database. `recordBillingEvent` is the
// only part that touches the DB.
//
// The central fact this file encodes: **Stripe never tells you a trial
// converted.** There is no `trial_converted` event. What you get is
// `customer.subscription.updated` with `status: 'active'`, which looks identical
// to a dozen other updates. A conversion is only visible as a *transition* —
// trialing -> active — so it can only be detected by comparing against the status
// we had cached before the write. That is why callers must capture
// `users.plan_status` BEFORE updating it and pass it as `previousStatus`; read it
// after and every conversion looks like a no-op.

const { sql } = require('drizzle-orm');
const { db, schema } = require('../db');

// Subscription statuses under which the family still has paid access.
// Mirrors the `activeish` list in server/routes/billing.js.
const ACCESS_STATUSES = ['active', 'trialing', 'past_due'];
// Terminal statuses: the subscription is over, not merely unhealthy.
const ENDED_STATUSES = ['canceled', 'unpaid', 'incomplete_expired'];

// Which funnel event (if any) a status transition represents. Returns null for
// the many updates that aren't funnel-interesting (plan swaps, card updates,
// past_due, renewals) — the log stays a funnel, not a mirror of Stripe.
//
// `previousStatus` is our cached status before this event (null for a brand-new
// subscription we've never seen).
function funnelEventForTransition({ previousStatus, status }) {
  if (status === 'trialing') {
    // Only the first sighting is a trial start; later trialing->trialing updates
    // (e.g. a plan change mid-trial) are not new trials.
    return previousStatus === 'trialing' ? null : 'trial_started';
  }
  if (status === 'active') {
    // The conversion. Note this is ONLY detectable as a transition — see the
    // header. A subscription that starts active (no trial, e.g. a promo code
    // that skipped it) is not a trial conversion and must not be counted as one.
    return previousStatus === 'trialing' ? 'trial_converted' : null;
  }
  if (ENDED_STATUSES.includes(status)) {
    // Churn, but only from a state that actually had access — an incomplete
    // checkout that expires was never a customer, and counting it as churn
    // would understate retention.
    return ACCESS_STATUSES.includes(previousStatus) ? 'churned' : null;
  }
  return null;
}

// The dedupe key for an event, at the grain that event is counted. Stripe
// delivers webhooks more than once, and two *different* Stripe events can
// describe one transition (`checkout.session.completed` and
// `customer.subscription.created` both land for a new trial), so keying on the
// Stripe event id would let a single trial start be counted twice. Lifecycle
// events therefore key on the subscription; repeatable ones key on the thing
// that legitimately repeats.
function dedupeKeyFor({ event, subscriptionId, invoiceId }) {
  if (event === 'payment_failed') {
    // Per invoice: a subscription can genuinely fail payment many times, but
    // Stripe's retries of one failure must collapse.
    return `payment_failed:${invoiceId || subscriptionId || 'unknown'}`;
  }
  return `${event}:${subscriptionId || 'unknown'}`;
}

// Which subscription an invoice belongs to, across both Invoice shapes. Stripe
// REMOVED the top-level `invoice.subscription` in API version 2025-03-31.basil and
// moved it under `parent.subscription_details`; the SDK pinned in package.json
// defaults to 2026-07-29.dahlia, but a webhook payload is rendered at the API
// version set on the *endpoint* in the Stripe dashboard, which can be older than
// the SDK. So read both rather than betting on either. Getting this wrong fails
// quietly rather than loudly: `payment_failed` dedupes on the invoice, so the row
// still lands — just with a null subscription id and no way to tie a dunning
// event back to the subscription that caused it.
function invoiceSubscriptionId(invoice) {
  const candidates = [
    invoice?.subscription,
    invoice?.parent?.subscription_details?.subscription,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (c?.id) return c.id;
  }
  return null;
}

// Append one funnel event. Never throws: instrumentation must not be able to
// fail a webhook and make Stripe retry a write that already succeeded. A
// duplicate delivery is a no-op via the dedupe_key unique index.
async function recordBillingEvent({
  userId = null,
  event,
  plan = null,
  subscriptionId = null,
  invoiceId = null,
  stripeEventId = null,
}) {
  if (!event) return;
  try {
    await db
      .insert(schema.billingEvents)
      .values({
        userId,
        event,
        plan,
        stripeSubscriptionId: subscriptionId,
        stripeEventId,
        dedupeKey: dedupeKeyFor({ event, subscriptionId, invoiceId }),
      })
      .onConflictDoNothing({ target: schema.billingEvents.dedupeKey });
  } catch (err) {
    console.error(`Could not record billing event ${event}:`, err.message);
  }
}

// Roll the log up into the numbers the question "is the trial working?" needs.
// Kept here (rather than in analytics.js) because it is founder-facing, not
// parent-facing, and the two must not share a payload.
async function trialFunnel() {
  // Counted in Postgres, not in JS: this log only grows, and one row per
  // subscription lifecycle event means an unbounded SELECT here would eventually
  // pull the whole table into memory on every admin page load. `count()` returns
  // bigint, which pg deserializes as a string — hence the ::int cast (same
  // reason analytics.js casts its averages to float8).
  const rows = await db
    .select({ event: schema.billingEvents.event, n: sql`count(*)::int` })
    .from(schema.billingEvents)
    .groupBy(schema.billingEvents.event);
  const counts = rows.reduce((acc, r) => {
    acc[r.event] = Number(r.n) || 0;
    return acc;
  }, {});
  const started = counts.trial_started || 0;
  const converted = counts.trial_converted || 0;
  return {
    trial_started: started,
    trial_converted: converted,
    churned: counts.churned || 0,
    payment_failed: counts.payment_failed || 0,
    // Null rather than 0 with no trials — a rate over an empty denominator is
    // not "0%", it's unknown (same rule as the nullable averages in analytics.js).
    conversion_rate: started > 0 ? converted / started : null,
  };
}

module.exports = {
  funnelEventForTransition,
  dedupeKeyFor,
  invoiceSubscriptionId,
  recordBillingEvent,
  trialFunnel,
  ACCESS_STATUSES,
  ENDED_STATUSES,
};
