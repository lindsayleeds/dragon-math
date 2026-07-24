// Regression tests for the "No such customer" self-heal (see GAPS.md §7c).
//
// The error payloads below are the real shapes, copied from the production pm2
// error log and from a read-only lookup against the live account.

const { isMissingCustomerError, staleCustomerReset } = require('./stripeCustomers');

// How stripe-node surfaces an API error: `code`/`param`/`message` are lifted off
// `raw` onto the error instance.
function stripeError({ code, param, message }) {
  const err = new Error(message);
  err.type = 'StripeInvalidRequestError';
  err.rawType = 'invalid_request_error';
  err.code = code;
  err.param = param;
  err.statusCode = 400;
  err.raw = { code, param, message, type: 'invalid_request_error' };
  return err;
}

describe('isMissingCustomerError', () => {
  const BAD = 'cus_UusoBcSPlClnMy'; // the id from the production log

  it('matches the billingPortal.sessions.create failure that caused the bug', () => {
    // Verbatim shape from dragonmath-api-error.log.
    const err = stripeError({
      code: 'resource_missing',
      param: 'customer',
      message: `No such customer: '${BAD}'`,
    });
    expect(isMissingCustomerError(err, BAD)).toBe(true);
  });

  it('matches the customers.retrieve failure (param is `id`, not `customer`)', () => {
    const err = stripeError({
      code: 'resource_missing',
      param: 'id',
      message: `No such customer: '${BAD}'`,
    });
    expect(isMissingCustomerError(err, BAD)).toBe(true);
  });

  // The regression this narrowing exists to prevent: the previous guard was
  // `err.code === 'resource_missing'` with no param check, so ANY missing
  // resource wiped a valid stripe_customer_id — which also unlinks the user
  // from their subscription webhooks (applySubscription matches on that column).
  it('does NOT match a missing Billing Portal configuration', () => {
    const err = stripeError({
      code: 'resource_missing',
      param: 'configuration',
      message:
        'No configuration provided and your default configuration has not been created.',
    });
    expect(isMissingCustomerError(err, 'cus_valid123')).toBe(false);
  });

  it('does NOT match a missing price on checkout', () => {
    const err = stripeError({
      code: 'resource_missing',
      param: 'line_items[0][price]',
      message: "No such price: 'price_nope'",
    });
    expect(isMissingCustomerError(err, 'cus_valid123')).toBe(false);
  });

  it('does NOT match unrelated Stripe errors', () => {
    expect(isMissingCustomerError(stripeError({ code: 'card_declined' }), 'cus_x')).toBe(false);
    expect(isMissingCustomerError(new Error('socket hang up'), 'cus_x')).toBe(false);
    expect(isMissingCustomerError(null, 'cus_x')).toBe(false);
    expect(isMissingCustomerError(undefined, 'cus_x')).toBe(false);
  });

  it('falls back to the message when Stripe sends no param', () => {
    const err = stripeError({ code: 'resource_missing', message: `No such customer: '${BAD}'` });
    expect(isMissingCustomerError(err, BAD)).toBe(true);
    // ...but only when the message actually names the id we passed, so a
    // reworded generic error can't be mistaken for a stale customer.
    expect(isMissingCustomerError(err, 'cus_someoneElse')).toBe(false);
    expect(isMissingCustomerError(err, null)).toBe(false);
  });

  it('reads code/param off `raw` if they are not lifted onto the instance', () => {
    const err = new Error(`No such customer: '${BAD}'`);
    err.code = 'resource_missing';
    err.raw = { code: 'resource_missing', param: 'customer' };
    expect(isMissingCustomerError(err, BAD)).toBe(true);
  });
});

describe('staleCustomerReset', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('retires the id and resets the stale plan cache to free', () => {
    // A customer Stripe cannot find has no subscription in this account, so a
    // cached paid plan means free premium forever if we only drop the id.
    expect(staleCustomerReset({ comped: false, now })).toEqual({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'free',
      planStatus: null,
      planRenewsAt: null,
      planCancelAtPeriodEnd: false,
      planUpdatedAt: now,
    });
  });

  it('never revokes a comped account — only drops the dead id', () => {
    // Comped plans are hand-granted and are not Stripe-derived; the same rule
    // applySubscription()/clearSubscription() enforce.
    expect(staleCustomerReset({ comped: true, now })).toEqual({ stripeCustomerId: null });
  });

  it('always clears the id, whichever branch runs', () => {
    for (const comped of [true, false]) {
      expect(staleCustomerReset({ comped, now }).stripeCustomerId).toBeNull();
    }
  });
});
