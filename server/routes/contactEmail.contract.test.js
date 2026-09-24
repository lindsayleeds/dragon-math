// A parent's contact email (ADR 0007): set it, change it, re-send the link, and
// redeem the link through the existing /parent/verify flow — driven over HTTP and
// checked against server/contracts/contactEmail.js.
//
// Server code is CommonJS, so fakes are wired the plain Node way (see
// auth.contract.test.js): Module._load swaps the rate limiter, the plan lookup
// and the auth emails (no Resend, nothing sent), and the db object's methods
// are replaced with fakes that answer from queues and record every write.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let signToken;
let expectContract;
let contract;
let schema;

// Queues and records, reset per test.
let selectRows;     // answers to select(...).limit(), in order
let returningRows;  // answers to update(...).returning() — token redemption
let updates;        // { table, values } for every update
let inserts;        // { table, values } for every insert
let sentEmails;     // { to, token } for every contact-verification email
let mailError;      // when set, the contact-verification email throws it
let rateAllowed;
const checked = new Set();

const RELAY = 'k3x9@privaterelay.appleid.com';

// An Apple parent who shared only a relay address: the first-sign-in case.
const RELAY_PARENT = {
  id: 7,
  username: RELAY,
  account_type: 'parent',
  email: RELAY,
  password_hash: null,
  google_sub: null,
  apple_sub: 'apple-sub-7',
  email_verified: false,
  contact_email: null,
  contact_email_verified: false,
  weekly_report_enabled: true,
  adult_role: 'parent',
  plan: 'premium',
};

const tableName = table => (table === schema.users ? 'users' : table === schema.authTokens ? 'auth_tokens' : '?');

function fakeSelect() {
  return {
    from() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    orderBy() { return Promise.resolve(selectRows.shift() ?? []); },
    limit() { return Promise.resolve(selectRows.shift() ?? []); },
  };
}

function fakeUpdate(table) {
  return {
    set(values) { updates.push({ table: tableName(table), values }); return this; },
    where() {
      return {
        returning: () => Promise.resolve(returningRows.shift() ?? []),
        then: (ok, err) => Promise.resolve().then(ok, err),
      };
    },
  };
}

function fakeInsert(table) {
  return {
    values(values) {
      inserts.push({ table: tableName(table), values });
      return {
        returning: () => Promise.resolve([{ id: 900 + inserts.length }]),
        then: (ok, err) => Promise.resolve().then(ok, err),
      };
    },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'contact-email-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: rateAllowed }) };
    if (request === '../lib/moderation') return { checkHandle: async () => ({ allowed: true }) };
    if (request === '../lib/entitlements') {
      const real = originalLoad.call(this, request, parent, isMain);
      return { ...real, effectivePlanForChild: async () => 'free', planForUser: async () => 'premium' };
    }
    if (request === '../lib/authEmails') {
      return {
        sendPasswordResetEmail: async () => { throw new Error('not expected'); },
        sendVerificationEmail: async () => { throw new Error('not expected'); },
        sendContactVerificationEmail: async (to, token) => {
          if (mailError) throw mailError;
          sentEmails.push({ to, token });
          return { stubbed: true };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  schema = dbModule.schema;
  dbModule.db.select = fakeSelect;
  dbModule.db.update = fakeUpdate;
  dbModule.db.insert = fakeInsert;

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));
  contract = require('../contracts/contactEmail.js');

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('./auth.js'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60_000);

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectRows = [];
  returningRows = [];
  updates = [];
  inserts = [];
  sentEmails = [];
  mailError = null;
  rateAllowed = true;
});

const parentSession = () => signToken({ id: 7, username: RELAY, account_type: 'parent', adult_role: 'parent' });
const childSession = () => signToken({ id: 11, username: 'sparky', account_type: 'child' });

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: method.toUpperCase(),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await expectContract(res, method, path);
  checked.add(`${method} ${path} ${res.status}`);
  return { status: res.status, body: json };
}

const userUpdates = () => updates.filter(u => u.table === 'users').map(u => u.values);
const tokenInserts = () => inserts.filter(i => i.table === 'auth_tokens').map(i => i.values);
const sha256 = raw => createHash('sha256').update(raw).digest('hex');

describe('PUT /api/auth/contact-email', () => {
  it('saves a new address unverified and emails a contact_verify link to it', async () => {
    selectRows = [[RELAY_PARENT], [{ ...RELAY_PARENT, contact_email: 'mum@example.test' }]];
    const res = await call('put', '/api/auth/contact-email', {
      token: parentSession(), body: { email: '  Mum@Example.TEST ' },
    });

    expect(res.status).toBe(200);
    expect(res.body.verification_sent).toBe(true);
    expect(res.body.user).toMatchObject({ contact_email: 'mum@example.test', contact_email_verified: false });
    expect(userUpdates()).toEqual([{ contactEmail: 'mum@example.test', contactEmailVerified: false }]);

    expect(sentEmails.map(e => e.to)).toEqual(['mum@example.test']);
    const [issued] = tokenInserts();
    expect(issued).toMatchObject({ userId: 7, kind: 'contact_verify', tokenHash: sha256(sentEmails[0].token) });
  });

  it('pre-expires the old link BEFORE the address changes', async () => {
    selectRows = [[{ ...RELAY_PARENT, contact_email: 'old@example.test' }], [RELAY_PARENT]];
    await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'new@example.test' } });

    const order = updates.map(u => (u.table === 'users' ? 'users' : 'expire'));
    // expire → set address → (issueAuthToken) expire again → insert
    expect(order).toEqual(['expire', 'users', 'expire']);
    expect(updates[0].values).toHaveProperty('usedAt');
  });

  it('changing a verified address un-verifies it until the new one is confirmed', async () => {
    const verified = { ...RELAY_PARENT, contact_email: 'old@example.test', contact_email_verified: true };
    selectRows = [[verified], [{ ...verified, contact_email: 'new@example.test', contact_email_verified: false }]];
    const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'new@example.test' } });

    expect(res.body.verification_sent).toBe(true);
    expect(userUpdates()).toEqual([{ contactEmail: 'new@example.test', contactEmailVerified: false }]);
    expect(sentEmails.map(e => e.to)).toEqual(['new@example.test']);
  });

  it('keeps the current verified address verified and sends nothing', async () => {
    const verified = { ...RELAY_PARENT, contact_email: 'mum@example.test', contact_email_verified: true };
    selectRows = [[verified], [verified]];
    const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'mum@example.test' } });

    expect(res.body).toMatchObject({ verification_sent: false, user: { contact_email_verified: true } });
    expect(userUpdates()).toEqual([{ contactEmail: 'mum@example.test', contactEmailVerified: true }]);
    expect(sentEmails).toEqual([]);
    expect(tokenInserts()).toEqual([]);
  });

  it('accepts a verified real login email as already proven', async () => {
    const webParent = { ...RELAY_PARENT, email: 'dad@example.test', email_verified: true };
    selectRows = [[webParent], [{ ...webParent, contact_email: 'dad@example.test', contact_email_verified: true }]];
    const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'dad@example.test' } });

    expect(res.body.verification_sent).toBe(false);
    expect(userUpdates()).toEqual([{ contactEmail: 'dad@example.test', contactEmailVerified: true }]);
    expect(sentEmails).toEqual([]);
  });

  it('refuses an Apple private relay address', async () => {
    const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: RELAY.toUpperCase() } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private relay/);
    expect(userUpdates()).toEqual([]);
    expect(sentEmails).toEqual([]);
  });

  it('refuses something that is not an email address', async () => {
    for (const body of [{}, { email: 'nope' }, { email: 42 }]) {
      const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Please enter a valid email address.');
    }
  });

  it('502s when the link cannot be sent, with the address saved', async () => {
    mailError = new Error('resend down');
    selectRows = [[RELAY_PARENT]];
    const res = await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'mum@example.test' } });
    expect(res.status).toBe(502);
    expect(userUpdates()).toEqual([{ contactEmail: 'mum@example.test', contactEmailVerified: false }]);
  });

  it('is for signed-in parents only, and rate limited', async () => {
    expect((await call('put', '/api/auth/contact-email', { body: { email: 'a@example.test' } })).status).toBe(401);
    expect((await call('put', '/api/auth/contact-email', { token: childSession(), body: { email: 'a@example.test' } })).status).toBe(403);
    expect((await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'a@example.test' } })).status).toBe(404);
    rateAllowed = false;
    expect((await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'a@example.test' } })).status).toBe(429);
  });
});

describe('POST /api/auth/contact-email/resend', () => {
  const pending = { ...RELAY_PARENT, contact_email: 'mum@example.test', contact_email_verified: false };

  it('sends a fresh link to the unverified contact email', async () => {
    selectRows = [[pending], [pending]];
    const res = await call('post', '/api/auth/contact-email/resend', { token: parentSession() });
    expect(res.status).toBe(200);
    expect(res.body.verification_sent).toBe(true);
    expect(sentEmails.map(e => e.to)).toEqual(['mum@example.test']);
    expect(tokenInserts()[0]).toMatchObject({ kind: 'contact_verify', tokenHash: sha256(sentEmails[0].token) });
  });

  it('is a no-op once verified', async () => {
    const verified = { ...pending, contact_email_verified: true };
    selectRows = [[verified], [verified]];
    const res = await call('post', '/api/auth/contact-email/resend', { token: parentSession() });
    expect(res.body.verification_sent).toBe(false);
    expect(sentEmails).toEqual([]);
  });

  it('409s with no contact email, 502s when mail fails, 404s and 429s', async () => {
    selectRows = [[RELAY_PARENT]];
    expect((await call('post', '/api/auth/contact-email/resend', { token: parentSession() })).status).toBe(409);
    mailError = new Error('down');
    selectRows = [[pending]];
    expect((await call('post', '/api/auth/contact-email/resend', { token: parentSession() })).status).toBe(502);
    expect((await call('post', '/api/auth/contact-email/resend', { token: parentSession() })).status).toBe(404);
    expect((await call('post', '/api/auth/contact-email/resend', { token: childSession() })).status).toBe(403);
    expect((await call('post', '/api/auth/contact-email/resend')).status).toBe(401);
    rateAllowed = false;
    expect((await call('post', '/api/auth/contact-email/resend', { token: parentSession() })).status).toBe(429);
  });
});

describe('POST /api/auth/email/verify', () => {
  it('a contact_verify link verifies the contact email, not the login email', async () => {
    returningRows = [[], [{ userId: 7 }]];  // not an email_verify token; a contact_verify one
    const res = await call('post', '/api/auth/email/verify', { body: { token: 'raw-contact-token' } });
    expect(res).toEqual({ status: 200, body: { ok: true, verified: 'contact_email' } });
    expect(userUpdates()).toEqual([{ contactEmailVerified: true }]);
  });

  it('a sign-up link still verifies the login email', async () => {
    returningRows = [[{ userId: 7 }]];
    const res = await call('post', '/api/auth/email/verify', { body: { token: 'raw-signup-token' } });
    expect(res).toEqual({ status: 200, body: { ok: true, verified: 'email' } });
    expect(userUpdates()).toEqual([{ emailVerified: true }]);
  });

  it('rejects an unknown, used or expired link with the old message', async () => {
    for (const body of [{ token: 'stale' }, {}, { token: '' }]) {
      returningRows = [[], []];
      const res = await call('post', '/api/auth/email/verify', { body });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('This confirmation link is invalid or has expired.');
    }
    expect(userUpdates()).toEqual([]);
  });

  it('change then re-verify: the new link verifies, the superseded one does not', async () => {
    // Set A, then change to B before confirming A.
    selectRows = [[RELAY_PARENT], [RELAY_PARENT]];
    await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'a@example.test' } });
    selectRows = [[{ ...RELAY_PARENT, contact_email: 'a@example.test' }], [RELAY_PARENT]];
    await call('put', '/api/auth/contact-email', { token: parentSession(), body: { email: 'b@example.test' } });
    const [linkA, linkB] = sentEmails.map(e => e.token);
    expect(sentEmails.map(e => e.to)).toEqual(['a@example.test', 'b@example.test']);
    expect(linkA).not.toBe(linkB);
    updates = [];

    // A's token was pre-expired by the change, so the database finds no row for it.
    returningRows = [[], []];
    expect((await call('post', '/api/auth/email/verify', { body: { token: linkA } })).status).toBe(400);
    returningRows = [[], [{ userId: 7 }]];
    expect((await call('post', '/api/auth/email/verify', { body: { token: linkB } })).body.verified).toBe('contact_email');
    expect(userUpdates()).toEqual([{ contactEmailVerified: true }]);
  });
});

describe('coverage', () => {
  it('checks a successful response for every route in the contact-email contract', () => {
    const missing = contract.routes.map(r => `${r.method} ${r.path} 200`).filter(key => !checked.has(key));
    expect(missing).toEqual([]);
  });
});
