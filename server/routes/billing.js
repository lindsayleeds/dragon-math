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
const {
  PAID_PLANS,
  PAID_GAME_IDS,
  TRIAL_PERIOD_DAYS,
  priceIdFor,
  planForPriceId,
  childLimit,
} = require('../lib/entitlements');
const { isMissingCustomerError, staleCustomerReset } = require('../lib/stripeCustomers');
const { planCatalog, formatAmount } = require('../lib/planCatalog');
const { sendTrialEndingEmail, sendPaymentFailedEmail } = require('../lib/billingEmails');
const {
  recordBillingEvent,
  funnelEventForTransition,
  invoiceSubscriptionId,
} = require('../lib/billingEvents');

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
        await applySubscription(event.data.object, event.id);
        break;
      }
      case 'customer.subscription.deleted': {
        await clearSubscription(event.data.object, event.id);
        break;
      }
      // Stripe fires this ~3 days before a trial converts. Checkout collects a
      // card up front and charges automatically, so this is the ONLY chance to
      // tell the parent before money moves — see server/lib/billingEmails.js.
      case 'customer.subscription.trial_will_end': {
        await handleTrialWillEnd(event.data.object, event.id);
        break;
      }
      // Dunning. Access is intentionally left intact (Stripe retries for ~2
      // weeks); this exists so a failed charge isn't completely silent.
      case 'invoice.payment_failed': {
        await handlePaymentFailed(event.data.object, event.id);
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
async function applySubscription(sub, stripeEventId = null) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const [user] = await db
    .select({
      id: schema.users.id,
      comped: schema.users.comped,
      // Read BEFORE the update below: a trial conversion is only visible as the
      // transition trialing -> active, so the cached status is the only record of
      // where we came from. See server/lib/billingEvents.js.
      planStatus: schema.users.planStatus,
    })
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

  // Funnel instrumentation (GAPS 6a) — after the write, so a logging problem can
  // never cost us the state update. recordBillingEvent swallows its own errors.
  await recordBillingEvent({
    userId: user.id,
    event: funnelEventForTransition({ previousStatus: user.planStatus, status: sub.status }),
    plan,
    subscriptionId: sub.id,
    stripeEventId,
  });
}

// Subscription ended — revert the user to free but keep their customer id so a
// future upgrade reuses the same Stripe customer.
async function clearSubscription(sub, stripeEventId = null) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  // Read the pre-update state so churn can be attributed to a user and counted
  // only for a subscription that actually had access (see billingEvents.js).
  const [user] = await db
    .select({
      id: schema.users.id,
      plan: schema.users.plan,
      planStatus: schema.users.planStatus,
      comped: schema.users.comped,
    })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);

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

  // A comped account's Stripe sub ending is not churn — its plan is hand-granted
  // and unchanged, so there is nothing to count.
  if (user && !user.comped) {
    await recordBillingEvent({
      userId: user.id,
      event: funnelEventForTransition({ previousStatus: user.planStatus, status: 'canceled' }),
      plan: user.plan,
      subscriptionId: sub.id,
      stripeEventId,
    });
  }
}

// Look up the account behind a Stripe customer id, with the fields the billing
// emails need. Returns null when the customer isn't ours (or is comped, whose
// plan Stripe doesn't govern — a comped account should never get a dunning or
// trial-ending notice about a subscription that isn't paying for its access).
async function billableUserForCustomer(customerId, context) {
  if (!customerId) return null;
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      plan: schema.users.plan,
      comped: schema.users.comped,
    })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customerId))
    .limit(1);
  if (!user) {
    console.warn(`Stripe ${context} for unknown customer ${customerId} — ignoring.`);
    return null;
  }
  if (user.comped) return null;
  return user;
}

// Read the price off a subscription's first item. Webhook payloads embed the full
// Price object, so this needs no extra Stripe call.
function subscriptionPrice(sub) {
  const price = sub.items?.data?.[0]?.price || null;
  return {
    plan: planForPriceId(price?.id) || null,
    amount: formatAmount(price?.unit_amount, price?.currency),
    interval: price?.recurring?.interval || 'month',
  };
}

// Trial ends in ~3 days: warn the parent that a charge is coming.
async function handleTrialWillEnd(sub, stripeEventId = null) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const user = await billableUserForCustomer(customerId, 'trial_will_end');
  if (!user) return;

  const { plan, amount, interval } = subscriptionPrice(sub);
  await recordBillingEvent({
    userId: user.id,
    event: 'trial_ending',
    plan: plan || user.plan,
    subscriptionId: sub.id,
    stripeEventId,
  });

  if (!user.email) {
    console.warn(`Trial ending for user ${user.id} with no email on file — cannot warn them.`);
    return;
  }
  try {
    await sendTrialEndingEmail({
      to: user.email,
      plan: plan || user.plan,
      amount,
      interval,
      endsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    });
  } catch (err) {
    // Never let a mail failure fail the webhook — Stripe would retry and we'd
    // re-do the (already durable) event write.
    console.error(`Could not send trial-ending email to user ${user.id}:`, err.message);
  }
}

// A charge failed. Access deliberately stays intact during Stripe's retry window;
// this is the notification that makes that window visible instead of silent.
async function handlePaymentFailed(invoice, stripeEventId = null) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const user = await billableUserForCustomer(customerId, 'invoice.payment_failed');
  if (!user) return;
  // A zero-amount invoice failing is noise (e.g. a fully discounted period);
  // there is nothing for the parent to fix.
  if (!invoice.amount_due) return;

  const subscriptionId = invoiceSubscriptionId(invoice);

  await recordBillingEvent({
    userId: user.id,
    event: 'payment_failed',
    plan: user.plan,
    subscriptionId,
    invoiceId: invoice.id,
    stripeEventId,
  });

  if (!user.email) {
    console.warn(`Payment failed for user ${user.id} with no email on file — cannot notify them.`);
    return;
  }
  try {
    await sendPaymentFailedEmail({
      to: user.email,
      amount: formatAmount(invoice.amount_due, invoice.currency),
      nextAttemptAt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
    });
  } catch (err) {
    console.error(`Could not send dunning email to user ${user.id}:`, err.message);
  }
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

// GET /api/billing/plans -> { trial_days, free, plans }
// Everything the upgrade modal is allowed to claim, derived from Stripe + the
// entitlement constants rather than hand-written into copy — see
// server/lib/planCatalog.js for why. Game ids (not names) are returned on
// purpose: src/data/games.js already owns display names.
router.get('/plans', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured.' });
  try {
    const plans = await planCatalog(id => stripe.prices.retrieve(id));
    res.json({
      trial_days: TRIAL_PERIOD_DAYS,
      // Card is collected at checkout and charged when the trial ends. Surfaced
      // so the modal states it rather than letting Stripe's page be the first
      // place a parent hears about it.
      trial_requires_card: true,
      free: {
        child_limit: childLimit('free'),
        locked_game_ids: [...PAID_GAME_IDS],
      },
      plans,
    });
  } catch (err) {
    console.error('Could not build plan catalog:', err);
    res.status(500).json({ error: 'Could not load plans. Please try again.' });
  }
});

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
      // Free trial (see docs/PRICING_STRATEGY.md decision 2). No card is charged
      // until it ends; webhook treats status 'trialing' as access-granting.
      // NOTE: `payment_method_collection` is intentionally left unset, which
      // means Stripe's subscription-mode default of 'always' applies — a card IS
      // required up front and auto-charged when the trial ends. That is the
      // product decision, but it makes disclosure load-bearing: TRIAL_PERIOD_DAYS
      // is shared with the upgrade modal's copy and the trial_will_end email
      // above so the parent is told the same thing in all three places.
      subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS },
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
