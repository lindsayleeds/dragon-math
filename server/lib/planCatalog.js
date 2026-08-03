// What the upgrade UI is allowed to claim about each paid plan.
//
// This exists because the copy drifted from the code once already: the 2026-07-20
// repricing cut the Premium child cap 9 -> 6 and gated three games, but the
// upgrade modal kept advertising "up to 9 children ... Dragon Munchers" — so a
// parent could buy Premium for 9 kids and hit a 402 at 6. The fix is to stop
// writing plan facts into copy at all. Every number here is derived:
//
//   price       -> Stripe (the actual Price the Checkout session will use)
//   childLimit  -> CHILD_LIMIT in ./entitlements
//   unlocks     -> PAID_GAME_IDS in ./entitlements (ids only; the client maps
//                  them to display names via src/data/games.js, which already
//                  owns them — duplicating names here would recreate the bug)
//
// Prices come from Stripe rather than a constant for the same reason: a repricing
// changes Stripe first, and anything we hand-maintain alongside it is what goes
// stale. Cached for an hour because a modal open must not become a Stripe round
// trip. In cluster mode each worker keeps its own copy, which is harmless — the
// data is read-only and identical.

const { PAID_PLANS, priceIdFor, childLimit, PAID_GAME_IDS, canUseDigest } = require('./entitlements');

const CACHE_TTL_MS = 60 * 60 * 1000;
const INTERVALS = ['month', 'year'];

let cache = null; // { at: epoch_ms, plans: [...] }

// Stripe amounts are in the currency's minor unit (cents for USD).
function formatAmount(unitAmount, currency) {
  if (typeof unitAmount !== 'number') return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(unitAmount / 100);
  } catch {
    // Unknown currency code — fall back to a bare decimal rather than throwing
    // and taking the whole modal down over a formatting detail.
    return String(unitAmount / 100);
  }
}

// Build the catalog. `retrievePrice(priceId)` resolves a Stripe Price object;
// injected so this is testable without a Stripe client. A price that is
// unconfigured or that Stripe rejects comes back as null for that interval —
// the caller renders what it has instead of failing the whole payload, since a
// missing yearly Price must not hide the monthly upgrade path.
async function buildPlanCatalog(retrievePrice) {
  const plans = [];
  for (const plan of PAID_PLANS) {
    const limit = childLimit(plan);
    const prices = {};
    for (const interval of INTERVALS) {
      const priceId = priceIdFor(plan, interval);
      if (!priceId) {
        prices[interval] = null;
        continue;
      }
      try {
        const price = await retrievePrice(priceId);
        prices[interval] = {
          amount: formatAmount(price?.unit_amount, price?.currency),
          unit_amount: price?.unit_amount ?? null,
          currency: price?.currency || null,
        };
      } catch (err) {
        console.error(`Could not load Stripe price ${priceId} for ${plan}/${interval}:`, err.message);
        prices[interval] = null;
      }
    }
    plans.push({
      key: plan,
      // null means unlimited — the client must not print "Infinity".
      child_limit: limit === Infinity ? null : limit,
      unlocks_game_ids: [...PAID_GAME_IDS],
      includes_digest: canUseDigest(plan),
      prices,
    });
  }
  return plans;
}

// Cached wrapper. `now` is injectable so a test can age the cache out without
// sleeping.
async function planCatalog(retrievePrice, { now = Date.now(), force = false } = {}) {
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.plans;
  const plans = await buildPlanCatalog(retrievePrice);
  // Only memoize a result that actually resolved a price. buildPlanCatalog
  // degrades instead of throwing (a missing yearly Price must not hide the
  // monthly path), which means a transient Stripe outage returns a well-formed
  // catalog with every price null — and caching THAT would show a price-less
  // modal to every parent for the next hour. An empty result is retried instead.
  if (plans.some(p => INTERVALS.some(i => p.prices?.[i]))) cache = { at: now, plans };
  return plans;
}

// Test seam: drop the memo so a following call refetches.
function clearPlanCatalogCache() {
  cache = null;
}

module.exports = {
  buildPlanCatalog,
  planCatalog,
  clearPlanCatalogCache,
  formatAmount,
  CACHE_TTL_MS,
};
