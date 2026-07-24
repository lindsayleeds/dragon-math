// Stripe self-serve billing (Phase 2 — see docs/MONETIZATION.md).
//
// Stripe is the source of truth for subscription state; `users.plan` (+ status /
// renews-at / stripe ids) is a write-through cache updated by the webhook here.
// The authenticated routes create a Checkout session (upgrade) and a Customer
// Portal session (manage/cancel). Everything else — proration, dunning, card
// updates — is handled by Stripe's hosted pages.

const express = require('express');
const { and, eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { PAID_PLANS, priceIdFor, planForPriceId } = require('../lib/entitlements');
const { isMissingCustomerError, staleCustomerReset } = require('../lib/stripeCustomers');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

// Lazily construct the client so the server still boots (and other routes work)
// when billing isn't configured yet. Routes below return 503 in that case.
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

const router = express.Router();

// ------------------------------- Webhook --------------------------------
// MUST be registered with a raw body (see server/index.js — the global JSON
// parser skips this path) so the Stripe signature can be verified.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Billing is not configured.' });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer
      req.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Ensure the customer is linked to the user even before the first
        // subscription.* event lands (client_reference_id = our user id).
        const userId = parseInt(session.client_reference_id, 10);
        if (Number.isInteger(userId) && session.customer) {
          await db
            .update(schema.users)
            .set({ stripeCustomerId: session.customer })
            .where(eq(schema.users.id, userId));
        }
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await applySubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await applySubscription(event.data.object);
        break;
      }
      case 'customer.subscription.deleted': {
        await clearSubscription(event.data.object);
        break;
      }
      default:
        // Ignore other event types.
        break;
    }
  } catch (err) {
    // Log but still 200 so Stripe doesn't hammer us; we can replay from the
    // dashboard if a write genuinely failed.
    console.error(`Error handling Stripe event ${event.type}:`, err);
  }

  res.json({ received: true });
});

// Write a subscription's state onto the owning user. Idempotent (last-write-wins,
// keyed by stripe_customer_id) so Stripe's retries are safe.
async function applySubscription(sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const [user] = await db
    .select({ id: schema.users.id, comped: schema.users.comped })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  if (!user) {
    console.warn(`Stripe subscription for unknown customer ${customerId} — ignoring.`);
    return;
  }
  // Comped ("lifetime free") accounts hold a permanent hand-granted plan. Never
  // let Stripe overwrite it — record the subscription id for reference only.
  if (user.comped) {
    await db
      .update(schema.users)
      .set({ stripeSubscriptionId: sub.id })
      .where(eq(schema.users.id, user.id));
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const plan = planForPriceId(priceId);
  // Statuses that still grant access. past_due keeps access during Stripe's
  // dunning window; canceled/unpaid/incomplete_expired drop to free.
  const activeish = ['active', 'trialing', 'past_due'];
  const grantsAccess = activeish.includes(sub.status) && plan;

  // Current Stripe API versions moved current_period_end off the Subscription
  // and onto its items — read whichever is present.
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  // A subscription is winding down if it's flagged to cancel at period end OR
  // carries a fixed future cancel_at date. Stripe uses either form depending on
  // how the cancellation was requested (portal vs. a scheduled cancel date).
  const willCancel = !!sub.cancel_at_period_end || sub.cancel_at != null;
  // planRenewsAt doubles as the wind-down date when cancelling (access ends on
  // cancel_at, else the period end) and the next-renewal date otherwise.
  const effectiveEnd = willCancel ? (sub.cancel_at ?? periodEnd) : periodEnd;

  await db
    .update(schema.users)
    .set({
      plan: grantsAccess ? plan : 'free',
      planStatus: sub.status,
      stripeSubscriptionId: sub.id,
      planRenewsAt: effectiveEnd ? new Date(effectiveEnd * 1000) : null,
      planCancelAtPeriodEnd: willCancel,
      planUpdatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));
}

// Subscription ended — revert the user to free but keep their customer id so a
// future upgrade reuses the same Stripe customer.
async function clearSubscription(sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  // Never downgrade a comped account when its (unrelated) Stripe sub ends.
  await db
    .update(schema.users)
    .set({
      plan: 'free',
      planStatus: 'canceled',
      stripeSubscriptionId: null,
      planRenewsAt: null,
      planCancelAtPeriodEnd: false,
      planUpdatedAt: new Date(),
    })
    .where(and(
      eq(schema.users.stripeCustomerId, customerId),
      eq(schema.users.comped, false),
    ));
}

// ------------------------- Authenticated routes -------------------------
router.use(requireAuth, requireParent);

// Retire a stored customer id that Stripe no longer recognises, along with the
// plan cache it was backing (comped accounts keep their hand-granted plan — see
// staleCustomerReset). Callers pass the `comped` flag from the row they already
// selected.
async function forgetStaleCustomer(userId, comped) {
  await db
    .update(schema.users)
    .set(staleCustomerReset({ comped: !!comped }))
    .where(eq(schema.users.id, userId));
}

// Find or lazily create this user's Stripe Customer, persisting the id.
async function getOrCreateCustomer(userId) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      stripeCustomerId: schema.users.stripeCustomerId,
      comped: schema.users.comped,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error('User not found');

  if (user.stripeCustomerId) {
    // Verify the stored customer still exists in the CURRENT Stripe account.
    // After a test->live account switch, old ids resolve to "No such customer"
    // (resource_missing); a portal-deleted customer comes back `deleted: true`.
    // Treat both as stale and mint a fresh customer below.
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (existing && !existing.deleted) return user.stripeCustomerId;
    } catch (err) {
      if (!isMissingCustomerError(err, user.stripeCustomerId)) throw err;
    }
    // Stale (missing or deleted). Drop the dead id *and* the plan cache it was
    // backing before minting a replacement, so an unreachable subscription
    // can't leave the account on a paid plan nobody is paying for.
    await forgetStaleCustomer(user.id, user.comped);
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    metadata: { userId: String(user.id) },
  });
  await db
    .update(schema.users)
    .set({ stripeCustomerId: customer.id })
    .where(eq(schema.users.id, user.id));
  return customer.id;
}

// POST /api/billing/checkout { plan, interval } -> { url }
// Creates a hosted Checkout session for a subscription upgrade.
router.post('/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured.' });

  const plan = typeof req.body?.plan === 'string' ? req.body.plan : '';
  const interval = typeof req.body?.interval === 'string' ? req.body.interval : 'month';
  if (!PAID_PLANS.includes(plan)) {
    return res.status(400).json({ error: `plan must be one of: ${PAID_PLANS.join(', ')}` });
  }
  const price = priceIdFor(plan, interval);
  if (!price) {
    return res.status(503).json({ error: 'That plan is not available for purchase yet.' });
  }

  try {
    const customer = await getOrCreateCustomer(req.user.id);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: String(req.user.id),
      line_items: [{ price, quantity: 1 }],
      success_url: `${APP_PUBLIC_URL}/parent?checkout=success`,
      cancel_url: `${APP_PUBLIC_URL}/parent?checkout=cancel`,
      allow_promotion_codes: true,
      // 14-day free trial (see docs/PRICING_STRATEGY.md decision 2). No card is
      // charged until it ends; webhook treats status 'trialing' as access-granting.
      subscription_data: { trial_period_days: 14 },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// POST /api/billing/portal -> { url }
// Opens the Stripe Customer Portal (change plan / update card / cancel).
router.post('/portal', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured.' });

  const [user] = await db
    .select({
      stripeCustomerId: schema.users.stripeCustomerId,
      comped: schema.users.comped,
    })
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user?.stripeCustomerId) {
    return res.status(400).json({ error: 'No billing account yet — upgrade first.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${APP_PUBLIC_URL}/parent`,
    });
    res.json({ url: session.url });
  } catch (err) {
    if (isMissingCustomerError(err, user.stripeCustomerId)) {
      // Stored customer no longer exists in this Stripe account (legacy
      // test-mode id — GAPS.md §7c). Self-heal rather than 500: retire the dead
      // id and its stale plan cache, then say plainly what happened. There is
      // nothing to recover *into* — a customer Stripe can't find has no
      // subscription here — so the way back is a fresh checkout, and
      // `can_manage_billing` now reads false so the button stops offering it.
      // One line, not the 50-line stack trace this used to dump. The id is
      // retired immediately, so this can't recur for the same customer.
      try {
        await forgetStaleCustomer(req.user.id, user.comped);
        console.warn(
          `Retired stale Stripe customer ${user.stripeCustomerId} for user ${req.user.id} (not found in this account).`,
        );
      } catch (resetErr) {
        // Still answer in JSON — src/api.js parses every response body, and this
        // router has no error middleware behind it to do that for us.
        console.warn(
          `Could not retire stale Stripe customer ${user.stripeCustomerId} for user ${req.user.id}: ${resetErr.message}`,
        );
      }
      return res.status(400).json({
        code: 'billing_account_missing',
        error: "We couldn't find a subscription to manage for your account.",
      });
    }
    console.error('Stripe portal error:', err);
    res.status(500).json({ error: 'Could not open billing portal. Please try again.' });
  }
});

module.exports = router;
