// The plan resolver (./planStatus.js) on its own: which grant a users row holds,
// and which of several grants wins. Route-level cover, including kids and the
// helpers the gates call, is server/routes/plan.contract.test.js.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/unused';
const { accountGrant, adultGrants, resolvePlanStatus } = require('./planStatus.js');

const grant = (source, plan) => ({ source, plan, expires_at: null, will_renew: null });

describe('accountGrant', () => {
  it('labels users.plan by where it came from without changing it', () => {
    expect(accountGrant({ plan: 'free' })).toBeNull();
    expect(accountGrant({ plan: 'premium', comped: true })).toMatchObject({ source: 'comp', plan: 'premium' });
    expect(accountGrant({ plan: 'premium' })).toMatchObject({ source: 'manual' });
    const renews = new Date('2026-10-01T00:00:00Z');
    expect(accountGrant({
      plan: 'classroom', planStatus: 'trialing', stripeSubscriptionId: 'sub_1', planRenewsAt: renews,
    })).toEqual({ source: 'stripe', plan: 'classroom', expires_at: renews, will_renew: true });
  });

  it('treats every access-granting Stripe status as Stripe', () => {
    for (const planStatus of ['active', 'trialing', 'past_due']) {
      expect(accountGrant({ plan: 'premium', planStatus, stripeSubscriptionId: 'sub_1' }).source).toBe('stripe');
    }
  });
});

describe('resolvePlanStatus', () => {
  it('is free with no grants', () => {
    expect(resolvePlanStatus([])).toEqual({ plan: 'free', source: null, expires_at: null, will_renew: null, grants: [] });
  });

  it('picks the highest plan, whatever the source', () => {
    const status = resolvePlanStatus([grant('app_store', 'premium'), grant('classroom', 'classroom'), grant('stripe', 'premium')]);
    expect(status.plan).toBe('classroom');
    expect(status.source).toBe('classroom');
    expect(status.grants.map(g => g.source)).toEqual(['classroom', 'stripe', 'app_store']);
  });

  it('breaks ties comp > stripe > app_store > manual > classroom', () => {
    const all = ['classroom', 'manual', 'app_store', 'stripe', 'comp'].map(s => grant(s, 'premium'));
    expect(resolvePlanStatus(all).grants.map(g => g.source)).toEqual(['comp', 'stripe', 'app_store', 'manual', 'classroom']);
  });

  it('drops free grants', () => {
    expect(resolvePlanStatus([grant('manual', 'free')]).grants).toEqual([]);
  });
});

describe('adultGrants', () => {
  it('combines the users row with entitled App Store rows only', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const later = new Date('2026-09-20T00:00:00Z');
    const rows = [
      { userId: 1, plan: 'premium', status: 'active', expiresAt: later, autoRenew: false },
      { userId: 1, plan: 'premium', status: 'expired', expiresAt: later },
    ];
    expect(adultGrants({ plan: 'free' }, rows, now)).toEqual([
      { source: 'app_store', plan: 'premium', expires_at: later, will_renew: false },
    ]);
  });
});
