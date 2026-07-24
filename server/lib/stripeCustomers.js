// Keeping `users.stripe_customer_id` honest against Stripe.
//
// A stored customer id can stop resolving in the *current* Stripe account. The
// documented cause in this project is the test->live account switch (GAPS.md
// §7c): ids minted under the old test key 404 against the live key. Nothing in
// this codebase ever writes an id it didn't get back from Stripe — the only
// writers are the `checkout.session.completed` webhook and
// `getOrCreateCustomer()` — so this is legacy data, not an ongoing source of
// bad ids.
//
// Pure on purpose (no db / no stripe imports) so the decisions below are unit
// testable without mocking the world. Callers own the DB writes.

// True only when Stripe is telling us THE CUSTOMER WE PASSED does not exist.
//
// Deliberately narrow: `resource_missing` is a generic code that Stripe also
// returns for other params — most relevantly a missing Billing Portal
// `configuration`. Treating one of those as a stale customer would delete a
// perfectly VALID `stripe_customer_id`, which is worse than the original error:
// `applySubscription()` matches incoming webhooks on that column, so an
// unlinked paying user would silently stop receiving plan updates.
//
// Observed shapes (both captured against the live account on 2026-07-24):
//   billingPortal.sessions.create({ customer: bad }) -> param: 'customer'
//   customers.retrieve(bad)                          -> param: 'id'
function isMissingCustomerError(err, customerId) {
  if (!err || err.code !== 'resource_missing') return false;

  const param = err.param ?? err.raw?.param ?? null;
  // The two params that mean "that customer": the `customer` argument we sent,
  // or the `id` of the customer we tried to retrieve.
  if (param === 'customer' || param === 'id') return true;
  // Some *other* resource is missing (e.g. `configuration`, `price`). Not ours.
  if (param) return false;

  // No param at all: only claim it if the message names the id we passed, so a
  // reworded generic error can never be mistaken for a stale customer.
  const message = err.message || err.raw?.message || '';
  return !!customerId && message.includes(customerId);
}

// The `users` patch that retires a stale customer id.
//
// A customer Stripe no longer knows about proves there is no subscription for
// this user in the current account, so the write-through plan cache (see the
// header of server/routes/billing.js) is stale too and must come back to free —
// otherwise a dead test-mode subscription leaves the account permanently paid
// with nobody paying. This mirrors the field set `clearSubscription()` writes.
//
// Comped ("lifetime free") accounts are the exception: their plan is
// hand-granted, never Stripe-derived, and must never be revoked by Stripe
// state — the same rule `applySubscription()`/`clearSubscription()` enforce.
// For them we only drop the dead id.
function staleCustomerReset({ comped, now = new Date() } = {}) {
  if (comped) return { stripeCustomerId: null };
  return {
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    plan: 'free',
    // null (not 'canceled') — nothing was cancelled; this account has no Stripe
    // state at all here. Matches the shape the manual GAPS.md §7c cleanup left.
    planStatus: null,
    planRenewsAt: null,
    planCancelAtPeriodEnd: false,
    planUpdatedAt: now,
  };
}

module.exports = { isMissingCustomerError, staleCustomerReset };
