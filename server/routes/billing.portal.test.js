// End-to-end regression test for POST /api/billing/portal — the route that
// produced the recurring `StripeInvalidRequestError: No such customer` in the
// production log (see GAPS.md §7c).
//
// billing.js is CommonJS and loads `../db` at require time, so it is wired up
// the plain Node way rather than with vi.mock (which does not intercept the
// require() calls inside a CJS module): `Module._load` swaps out the `stripe`
// client and the auth middleware, and the exported `db` object's methods are
// replaced with recording fakes. Nothing here touches a real database or a real
// Stripe account.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

// --- fakes -----------------------------------------------------------------

// Rows are handed out in the order the route selects them; every write is
// recorded so tests can assert exactly what was persisted.
function makeFakeDb() {
  const state = { selectRows: [], updates: [], selects: 0 };
  const db = {
    select() {
      return {
        from() { return this; },
        where() { return this; },
        limit() {
          state.selects += 1;
          return Promise.resolve(state.selectRows.shift() ?? []);
        },
      };
    },
    update() {
      const rec = {};
      return {
        set(patch) { rec.patch = patch; return this; },
        where() { state.updates.push(rec); return Promise.resolve(); },
      };
    },
  };
  return { db, state };
}

function stripeError({ code, param, message }) {
  const err = new Error(message);
  err.type = 'StripeInvalidRequestError';
  err.code = code;
  err.param = param;
  err.statusCode = 400;
  err.raw = { code, param, message, type: 'invalid_request_error' };
  return err;
}

// --- harness ---------------------------------------------------------------

let server;
let baseUrl;
let fake;          // { db, state }
let portalCreate;  // swappable stripe.billingPortal.sessions.create stub
let originalLoad;

beforeAll(async () => {
  // db.js throws unless DATABASE_URL is set. pg's Pool is lazy — it never
  // connects, because every db method is replaced below.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  // Non-empty so billing.js builds a (faked) client instead of 503-ing.
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_never_sent_anywhere';
  process.env.APP_PUBLIC_URL = 'https://example.test';

  const fakeStripe = {
    billingPortal: { sessions: { create: (...args) => portalCreate(...args) } },
    customers: {},
  };

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'stripe') return () => fakeStripe;
    if (request === '../middleware/auth') {
      // Test double only — the real requireAuth/requireParent are untouched.
      const pass = (_req, _res, next) => next();
      return { requireAuth: pass, requireParent: pass };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  fake = makeFakeDb();
  const dbModule = require('../db.js');
  // Patch in place: billing.js destructures this same object at load time.
  dbModule.db.select = fake.db.select;
  dbModule.db.update = fake.db.update;

  const express = require('express');
  const billingRouter = require('./billing.js');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 10056 }; next(); });
  app.use('/api/billing', billingRouter);

  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

function resetDb(selectRows) {
  fake.state.selectRows = selectRows;
  fake.state.updates = [];
  fake.state.selects = 0;
}

const openPortal = () =>
  fetch(`${baseUrl}/api/billing/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

// --- tests -----------------------------------------------------------------

describe('POST /api/billing/portal', () => {
  it('opens the portal for a valid customer (no regression)', async () => {
    resetDb([[{ stripeCustomerId: 'cus_valid123' }]]);
    portalCreate = async ({ customer }) => {
      expect(customer).toBe('cus_valid123');
      return { url: 'https://billing.stripe.com/session/live' };
    };

    const res = await openPortal();
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://billing.stripe.com/session/live');
    // A working customer must never be unlinked.
    expect(fake.state.updates).toEqual([]);
  });

  it('self-heals a stale customer id instead of throwing (the reported bug)', async () => {
    // Reproduction: the exact failure from the production log.
    resetDb([
      [{ stripeCustomerId: 'cus_UusoBcSPlClnMy' }], // the route's own lookup
      [{ comped: false }],                          // forgetStaleCustomer's lookup
    ]);
    portalCreate = async () => {
      throw stripeError({
        code: 'resource_missing',
        param: 'customer',
        message: "No such customer: 'cus_UusoBcSPlClnMy'",
      });
    };

    const res = await openPortal();
    // Handled, not a 500 crash.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('billing_account_missing');
    expect(body.error).toMatch(/Free plan/);

    // The dead id and the plan cache it was backing are both retired.
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].patch).toMatchObject({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: 'free',
      planStatus: null,
      planRenewsAt: null,
      planCancelAtPeriodEnd: false,
    });
  });

  it('never revokes a comped plan while retiring a stale id', async () => {
    resetDb([
      [{ stripeCustomerId: 'cus_staleButComped' }],
      [{ comped: true }],
    ]);
    portalCreate = async () => {
      throw stripeError({
        code: 'resource_missing',
        param: 'customer',
        message: "No such customer: 'cus_staleButComped'",
      });
    };

    const res = await openPortal();
    expect(res.status).toBe(400);
    // Not the downgrade wording — nothing was downgraded.
    expect((await res.json()).error).toBe('No billing account yet — upgrade first.');
    expect(fake.state.updates[0].patch).toEqual({ stripeCustomerId: null });
  });

  it('keeps a valid customer id when some OTHER resource is missing', async () => {
    // The regression guard: a missing Billing Portal *configuration* also comes
    // back as `resource_missing`. The old code would have wiped a good id here,
    // unlinking the user from their subscription webhooks.
    resetDb([[{ stripeCustomerId: 'cus_valid123' }]]);
    portalCreate = async () => {
      throw stripeError({
        code: 'resource_missing',
        param: 'configuration',
        message: 'No configuration provided and your default configuration has not been created.',
      });
    };

    const res = await openPortal();
    expect(res.status).toBe(500);
    expect(fake.state.updates).toEqual([]);
  });

  it('short-circuits when the user has no customer id at all', async () => {
    resetDb([[{ stripeCustomerId: null }]]);
    portalCreate = async () => { throw new Error('stripe must not be called'); };

    const res = await openPortal();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No billing account yet — upgrade first.');
    expect(fake.state.updates).toEqual([]);
  });
});
