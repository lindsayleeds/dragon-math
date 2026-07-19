// Stripe self-serve billing (Phase 2 — see docs/MONETIZATION.md).
//
// Stripe is the source of truth for subscription state; `users.plan` (+ status /
// renews-at / stripe ids) is a write-through cache updated by the webhook here.
// The authenticated routes create a Checkout session (upgrade) and a Customer
// Portal session (manage/cancel). Everything else — proration, dunning, card
// updates — is handled by Stripe's hosted pages.

const express = require('express');
const { eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { PAID_PLANS, priceIdFor, planForPriceId } = require('../lib/entitlements');

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
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  if (!user) {
    console.warn(`Stripe subscription for unknown customer ${customerId} — ignoring.`);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const plan = planForPriceId(priceId);
  // Statuses that still grant access. past_due keeps access during Stripe's
  // dunning window; canceled/unpaid/incomplete_expired drop to free.
  const activeish = ['active', 'trialing', 'past_due'];
  const grantsAccess = activeish.includes(sub.status) && plan;

  await db
    .update(schema.users)
    .set({
      plan: grantsAccess ? plan : 'free',
      planStatus: sub.status,
      stripeSubscriptionId: sub.id,
      planRenewsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      planUpdatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));
}

// Subscription ended — revert the user to free but keep their customer id so a
// future upgrade reuses the same Stripe customer.
async function clearSubscription(sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  await db
    .update(schema.users)
    .set({
      plan: 'free',
      planStatus: 'canceled',
      stripeSubscriptionId: null,
      planRenewsAt: null,
      planUpdatedAt: new Date(),
    })
    .where(eq(schema.users.stripeCustomerId, customerId));
}

// ------------------------- Authenticated routes -------------------------
router.use(requireAuth, requireParent);

// Find or lazily create this user's Stripe Customer, persisting the id.
async function getOrCreateCustomer(userId) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      stripeCustomerId: schema.users.stripeCustomerId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

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
    .select({ stripeCustomerId: schema.users.stripeCustomerId })
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
    console.error('Stripe portal error:', err);
    res.status(500).json({ error: 'Could not open billing portal. Please try again.' });
  }
});

module.exports = router;
