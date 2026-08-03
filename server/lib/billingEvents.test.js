// Funnel-event derivation (GAPS 6a). These are the decisions that decide whether
// the trial-conversion number is true, so they are pinned here rather than left
// to be checked against live Stripe traffic.
//
// billingEvents.js requires ../db at load time (db.js throws with no
// DATABASE_URL), so the env var is set before the import. pg's Pool is lazy and
// nothing here calls a db method, so no connection is ever opened.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let funnelEventForTransition;
let dedupeKeyFor;
let invoiceSubscriptionId;

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  ({
    funnelEventForTransition,
    dedupeKeyFor,
    invoiceSubscriptionId,
  } = require('./billingEvents.js'));
});

describe('funnelEventForTransition', () => {
  it('counts a new trialing subscription as a trial start', () => {
    expect(funnelEventForTransition({ previousStatus: null, status: 'trialing' }))
      .toBe('trial_started');
  });

  it('does not re-count a trial on a second trialing update', () => {
    // Stripe sends `customer.subscription.updated` for plan swaps and card
    // changes mid-trial. Counting those would inflate the funnel denominator.
    expect(funnelEventForTransition({ previousStatus: 'trialing', status: 'trialing' }))
      .toBeNull();
  });

  it('counts trialing -> active as the conversion', () => {
    // The whole reason previousStatus has to be captured before the DB write:
    // Stripe has no trial_converted event, only this transition.
    expect(funnelEventForTransition({ previousStatus: 'trialing', status: 'active' }))
      .toBe('trial_converted');
  });

  it('does not count a subscription that started active as a conversion', () => {
    // e.g. a 100% promo code that skips the trial. Real revenue, but it never
    // entered the trial funnel, so counting it would push conversion over 100%.
    expect(funnelEventForTransition({ previousStatus: null, status: 'active' }))
      .toBeNull();
  });

  it('does not count a recovered dunning payment as a conversion', () => {
    // past_due -> active is a rescued card, not a trial converting.
    expect(funnelEventForTransition({ previousStatus: 'past_due', status: 'active' }))
      .toBeNull();
  });

  it('does not emit on an ordinary renewal', () => {
    expect(funnelEventForTransition({ previousStatus: 'active', status: 'active' }))
      .toBeNull();
  });

  it('does not treat past_due as churn', () => {
    // Access is retained during Stripe's retry window; the subscription is
    // unhealthy, not over.
    expect(funnelEventForTransition({ previousStatus: 'active', status: 'past_due' }))
      .toBeNull();
  });

  it.each(['canceled', 'unpaid', 'incomplete_expired'])(
    'counts %s as churn when the subscription had access',
    (status) => {
      expect(funnelEventForTransition({ previousStatus: 'active', status }))
        .toBe('churned');
    },
  );

  it('counts a cancelled trial as churn', () => {
    expect(funnelEventForTransition({ previousStatus: 'trialing', status: 'canceled' }))
      .toBe('churned');
  });

  it('does not count an abandoned checkout as churn', () => {
    // `incomplete` never granted access — the card was never charged. Counting
    // it would understate retention against a denominator of real customers.
    expect(funnelEventForTransition({ previousStatus: 'incomplete', status: 'incomplete_expired' }))
      .toBeNull();
    expect(funnelEventForTransition({ previousStatus: null, status: 'canceled' }))
      .toBeNull();
  });
});

describe('dedupeKeyFor', () => {
  it('keys lifecycle events on the subscription, not the Stripe event', () => {
    // Two different Stripe events (checkout.session.completed and
    // customer.subscription.created) both describe one trial start; keying on
    // the event id would count that trial twice.
    expect(dedupeKeyFor({ event: 'trial_started', subscriptionId: 'sub_1' }))
      .toBe('trial_started:sub_1');
    expect(dedupeKeyFor({ event: 'trial_converted', subscriptionId: 'sub_1' }))
      .toBe('trial_converted:sub_1');
  });

  it('distinguishes different lifecycle events on the same subscription', () => {
    const started = dedupeKeyFor({ event: 'trial_started', subscriptionId: 'sub_1' });
    const churned = dedupeKeyFor({ event: 'churned', subscriptionId: 'sub_1' });
    expect(started).not.toBe(churned);
  });

  it('keys payment failures per invoice so repeat failures both count', () => {
    const first = dedupeKeyFor({ event: 'payment_failed', subscriptionId: 'sub_1', invoiceId: 'in_1' });
    const second = dedupeKeyFor({ event: 'payment_failed', subscriptionId: 'sub_1', invoiceId: 'in_2' });
    expect(first).toBe('payment_failed:in_1');
    expect(first).not.toBe(second);
  });

  it('still produces a stable key when Stripe ids are missing', () => {
    // The unique index is NOT NULL; a key of `undefined` would throw on insert
    // and lose the event entirely.
    expect(dedupeKeyFor({ event: 'churned' })).toBe('churned:unknown');
    expect(dedupeKeyFor({ event: 'payment_failed' })).toBe('payment_failed:unknown');
  });
});

// Stripe moved this field. The SDK pinned here defaults to a 2026 API version,
// where `invoice.subscription` does not exist — but the webhook payload is
// rendered at whatever version the dashboard endpoint is set to, so both shapes
// have to resolve. A miss here is silent: the row still lands (payment_failed
// dedupes on the invoice), just with nothing linking it to a subscription.
describe('invoiceSubscriptionId', () => {
  it('reads the pre-2025-03-31 top-level field', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_legacy' })).toBe('sub_legacy');
  });

  it('reads the current parent.subscription_details field', () => {
    expect(invoiceSubscriptionId({
      parent: { subscription_details: { subscription: 'sub_new' } },
    })).toBe('sub_new');
  });

  it('unwraps an expanded subscription object in either position', () => {
    expect(invoiceSubscriptionId({ subscription: { id: 'sub_exp' } })).toBe('sub_exp');
    expect(invoiceSubscriptionId({
      parent: { subscription_details: { subscription: { id: 'sub_exp2' } } },
    })).toBe('sub_exp2');
  });

  it('returns null for a one-off invoice with no subscription at all', () => {
    expect(invoiceSubscriptionId({ id: 'in_1' })).toBe(null);
    expect(invoiceSubscriptionId({})).toBe(null);
    expect(invoiceSubscriptionId(null)).toBe(null);
  });
});
