// The plan catalog exists to stop upgrade copy from drifting away from the code
// (the shipped modal advertised "up to 9 children" long after the cap became 6).
// These tests pin the derivation, especially the failure modes — a catalog that
// throws or that quietly omits a plan takes the upgrade path down with it.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let buildPlanCatalog;
let planCatalog;
let clearPlanCatalogCache;
let formatAmount;
let CHILD_LIMIT;
let PAID_GAME_IDS;

beforeAll(() => {
  // entitlements.js reads the Price ids from env at load, and requires ../db
  // (which throws with no DATABASE_URL). Nothing connects — no db method is called.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_prem_m';
  process.env.STRIPE_PRICE_PREMIUM_YEARLY = 'price_prem_y';
  process.env.STRIPE_PRICE_CLASSROOM_MONTHLY = 'price_class_m';
  process.env.STRIPE_PRICE_CLASSROOM_YEARLY = 'price_class_y';

  ({ buildPlanCatalog, planCatalog, clearPlanCatalogCache, formatAmount } = require('./planCatalog.js'));
  ({ CHILD_LIMIT, PAID_GAME_IDS } = require('./entitlements.js'));
});

beforeEach(() => clearPlanCatalogCache());

const PRICES = {
  price_prem_m:  { id: 'price_prem_m',  unit_amount: 799,  currency: 'usd' },
  price_prem_y:  { id: 'price_prem_y',  unit_amount: 5999, currency: 'usd' },
  price_class_m: { id: 'price_class_m', unit_amount: 999,  currency: 'usd' },
  price_class_y: { id: 'price_class_y', unit_amount: 7999, currency: 'usd' },
};
const retrieveOk = async id => PRICES[id];

describe('formatAmount', () => {
  it('renders Stripe minor units as currency', () => {
    expect(formatAmount(799, 'usd')).toBe('$7.99');
    expect(formatAmount(5999, 'usd')).toBe('$59.99');
  });

  it('returns null for a missing amount rather than "$0.00"', () => {
    // A price we couldn't load must read as "unknown", never as free.
    expect(formatAmount(null, 'usd')).toBeNull();
    expect(formatAmount(undefined, 'usd')).toBeNull();
  });

  it('survives an unrecognised currency instead of throwing', () => {
    expect(() => formatAmount(799, 'notacurrency')).not.toThrow();
  });
});

describe('buildPlanCatalog', () => {
  it('takes the child limit from CHILD_LIMIT, not from copy', async () => {
    const plans = await buildPlanCatalog(retrieveOk);
    const premium = plans.find(p => p.key === 'premium');
    expect(premium.child_limit).toBe(CHILD_LIMIT.premium);
    // The specific regression: the modal said 9 while the code enforced 6.
    expect(premium.child_limit).toBe(6);
  });

  it('reports an unlimited plan as null, never Infinity', async () => {
    // JSON.stringify(Infinity) is `null` anyway, but going through the wire as a
    // deliberate null keeps the client from printing "Infinity children".
    const plans = await buildPlanCatalog(retrieveOk);
    const classroom = plans.find(p => p.key === 'classroom');
    expect(classroom.child_limit).toBeNull();
    expect(JSON.stringify(plans)).not.toContain('Infinity');
  });

  it('lists every paid game id, so copy cannot undersell the tier', async () => {
    // The modal credited Premium with only Dragon Munchers while three games
    // were actually gated.
    const plans = await buildPlanCatalog(retrieveOk);
    expect(plans.find(p => p.key === 'premium').unlocks_game_ids).toEqual(PAID_GAME_IDS);
    expect(PAID_GAME_IDS.length).toBeGreaterThan(1);
  });

  it('carries the real Stripe amounts', async () => {
    const plans = await buildPlanCatalog(retrieveOk);
    const premium = plans.find(p => p.key === 'premium');
    expect(premium.prices.month.amount).toBe('$7.99');
    expect(premium.prices.year.amount).toBe('$59.99');
  });

  it('keeps the monthly path when only the yearly Price fails', async () => {
    // A partly-broken catalog must not hide the upgrade button entirely.
    const retrieve = async (id) => {
      if (id === 'price_prem_y') throw new Error('No such price');
      return PRICES[id];
    };
    const plans = await buildPlanCatalog(retrieve);
    const premium = plans.find(p => p.key === 'premium');
    expect(premium.prices.year).toBeNull();
    expect(premium.prices.month.amount).toBe('$7.99');
  });

  it('still returns the plan when its Price is unconfigured', async () => {
    delete process.env.STRIPE_PRICE_PREMIUM_YEARLY;
    // entitlements captured PLAN_PRICES at load, so re-require under a fresh
    // module registry to observe the unset env.
    const path = require.resolve('./planCatalog.js');
    const entPath = require.resolve('./entitlements.js');
    delete require.cache[path];
    delete require.cache[entPath];
    const fresh = require('./planCatalog.js');
    const plans = await fresh.buildPlanCatalog(retrieveOk);
    expect(plans.find(p => p.key === 'premium').prices.year).toBeNull();
    // Restore for any later test in this file.
    process.env.STRIPE_PRICE_PREMIUM_YEARLY = 'price_prem_y';
    delete require.cache[path];
    delete require.cache[entPath];
  });
});

describe('planCatalog caching', () => {
  it('does not hit Stripe again inside the TTL', async () => {
    let calls = 0;
    const counting = async (id) => { calls += 1; return PRICES[id]; };
    await planCatalog(counting, { now: 1_000 });
    const afterFirst = calls;
    await planCatalog(counting, { now: 1_000 + 60_000 });
    expect(calls).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
  });

  it('refetches once the TTL has passed', async () => {
    let calls = 0;
    const counting = async (id) => { calls += 1; return PRICES[id]; };
    await planCatalog(counting, { now: 1_000 });
    const afterFirst = calls;
    const { CACHE_TTL_MS } = require('./planCatalog.js');
    await planCatalog(counting, { now: 1_000 + CACHE_TTL_MS + 1 });
    expect(calls).toBeGreaterThan(afterFirst);
  });

  // buildPlanCatalog degrades rather than throwing, so a Stripe outage yields a
  // well-formed catalog with every price null. Memoizing that would show a
  // price-less upgrade modal to every parent for the rest of the hour, long after
  // Stripe recovered — so a result with no prices in it must not be cached.
  it('does not cache a catalog whose every price failed', async () => {
    let failing = true;
    let calls = 0;
    const flaky = async (id) => {
      calls += 1;
      if (failing) throw new Error('stripe is down');
      return PRICES[id];
    };

    const during = await planCatalog(flaky, { now: 1_000 });
    expect(during.every(p => !p.prices.month && !p.prices.year)).toBe(true);
    const afterOutage = calls;

    // Well inside the TTL: a cached empty catalog would return without asking.
    failing = false;
    const after = await planCatalog(flaky, { now: 2_000 });
    expect(calls).toBeGreaterThan(afterOutage);
    expect(after.find(p => p.key === 'premium').prices.month.amount).toBe('$7.99');
  });

  it('still caches a partial catalog, so one dead Price is not retried forever', async () => {
    let calls = 0;
    const oneDead = async (id) => {
      calls += 1;
      if (id === 'price_prem_y') throw new Error('archived');
      return PRICES[id];
    };
    await planCatalog(oneDead, { now: 1_000 });
    const afterFirst = calls;
    await planCatalog(oneDead, { now: 1_000 + 60_000 });
    expect(calls).toBe(afterFirst);
  });
});
