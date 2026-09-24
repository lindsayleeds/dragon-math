// The kid sign-in and kid-profile routes, driven over HTTP and checked against
// their contract (server/contracts/auth.js) — the schemas openapi.json and the
// Swift client are generated from. Also pins that adding input schemas kept the
// routes' behaviour for valid input (numeric-string ids, trimmed tokens) and
// their error messages for invalid input.
//
// Server code is CommonJS, so fakes are wired the plain Node way (see CLAUDE.md,
// Tests): Module._load for the rate limiter, moderation and plan lookup, and
// methods replaced on the object `require('../db')` returns.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let selectRows;
let updates;
let signToken;
let expectContract;
let authContract;
let inserts;
let insertError;
let appleKey;
let appleKeySet;
const checked = new Set();

const CHILD_ROW = {
  id: 11,
  username: 'sparky',
  current_node_id: 3,
  avatar: '🐉',
  font: 'clean',
  account_type: 'child',
  email: null,
  password_hash: null,
  google_sub: null,
  email_verified: false,
  weekly_report_enabled: true,
  adult_role: 'parent',
  plan: 'free',
  active_companion_id: null,
  dragon_trial_completed: true,
  needs_handle: false,
};

const PARENT_ROW = {
  ...CHILD_ROW,
  id: 7,
  username: 'grownup@example.com',
  account_type: 'parent',
  email: 'grownup@example.com',
  email_verified: true,
  plan: 'premium',
};

const LOGIN_TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
const FAMILY_TOKEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SIBLINGS = [
  { id: 11, username: 'sparky', avatar: '🐉', needs_handle: false },
  { id: 12, username: 'ember', avatar: '🦊', needs_handle: true },
];

function fakeSelect() {
  return {
    from() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    orderBy() { return Promise.resolve(selectRows.shift() ?? []); },
    limit() { return Promise.resolve(selectRows.shift() ?? []); },
  };
}

function fakeInsert() {
  return {
    values(values) { inserts.push(values); return this; },
    returning() {
      if (insertError) return Promise.reject(insertError);
      return Promise.resolve([{ id: 500 + inserts.length }]);
    },
  };
}

function fakeUpdate() {
  return {
    set(values) { updates.push(values); return this; },
    where() { return Promise.resolve(); },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-contract-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: true }) };
    if (request === '../lib/moderation') return { checkHandle: async () => ({ allowed: true }) };
    if (request === '../lib/entitlements') {
      const real = originalLoad.call(this, request, parent, isMain);
      // The resolver's own cover is server/lib/planStatus.test.js and
      // server/routes/appStore.test.js; here the parent row's plan stands in.
      return {
        ...real,
        effectivePlanForChild: async () => 'free',
        planForUser: async id => (id === PARENT_ROW.id ? PARENT_ROW.plan : 'free'),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;
  dbModule.db.update = fakeUpdate;
  dbModule.db.insert = fakeInsert;

  // Sign in with Apple: verify against a locally generated key instead of
  // fetching Apple's. One key only — RSA generation can take seconds on a busy
  // machine, hence this hook's longer timeout.
  process.env.APPLE_CLIENT_IDS = 'com.example.dragonacademy, com.example.web';
  appleKey = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(appleKey.publicKey)), kid: 'apple-test-key', alg: 'RS256', use: 'sig' };
  appleKeySet = createLocalJWKSet({ keys: [jwk] });
  require('../lib/appleIdentity.js').setAppleKeySet(appleKeySet);

  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth.js');
  signToken = claims => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' });
  ({ expectContract } = require('../contracts/testing.js'));
  authContract = require('../contracts/auth.js');

  const express = require('express');
  const authRouter = require('./auth.js');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60_000);

afterAll(async () => {
  require('../lib/appleIdentity.js').setAppleKeySet(null);
  delete process.env.APPLE_CLIENT_IDS;
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectRows = [];
  updates = [];
  inserts = [];
  insertError = null;
});

const childSession = (extra = {}) => signToken({ id: 11, username: 'sparky', account_type: 'child', ...extra });
const familySession = () => childSession({ family_parent_id: 7 });

// Calls a route and checks the response against the contract for `path` (the
// OpenAPI template, e.g. /api/auth/family/{token}).
async function call(method, path, { url = path, token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${url}`, {
    method: method.toUpperCase(),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await expectContract(res, method, path);
  checked.add(`${method} ${path} ${res.status}`);
  return { status: res.status, body: json };
}

describe('GET /api/auth/me', () => {
  it('returns a child user', async () => {
    selectRows = [[CHILD_ROW]];
    const res = await call('get', '/api/auth/me', { token: childSession() });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 11, account_type: 'child', effective_plan: 'free' });
    expect(res.body.user.family_mode).toBeUndefined();
  });

  it('marks a family-device session', async () => {
    selectRows = [[CHILD_ROW]];
    const res = await call('get', '/api/auth/me', { token: familySession() });
    expect(res.body.user.family_mode).toBe(true);
  });

  it('returns an adult user', async () => {
    selectRows = [[PARENT_ROW]];
    const res = await call('get', '/api/auth/me', { token: childSession({ id: 7, account_type: 'parent' }) });
    expect(res.body.user).toMatchObject({ account_type: 'parent', plan: 'premium' });
  });

  it('401s without a session and 404s for a deleted user', async () => {
    expect((await call('get', '/api/auth/me')).status).toBe(401);
    expect((await call('get', '/api/auth/me', { token: childSession() })).status).toBe(404);
  });
});

describe('POST /api/auth/child-login', () => {
  it('signs a child in, trimming the token', async () => {
    selectRows = [[CHILD_ROW]];
    const res = await call('post', '/api/auth/child-login', { body: { token: `  ${LOGIN_TOKEN.toUpperCase()} ` } });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('sparky');
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects a malformed token with the same message as before', async () => {
    for (const body of [{}, { token: 'nope' }, { token: 42 }, []]) {
      const res = await call('post', '/api/auth/child-login', { body });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('That link looks broken.');
    }
  });

  it('404s an unknown token and 403s an admin', async () => {
    expect((await call('post', '/api/auth/child-login', { body: { token: LOGIN_TOKEN } })).status).toBe(404);
    selectRows = [[{ ...PARENT_ROW, account_type: 'admin' }]];
    expect((await call('post', '/api/auth/child-login', { body: { token: LOGIN_TOKEN } })).status).toBe(403);
  });
});

describe('family device routes', () => {
  it('lists a family by its link', async () => {
    selectRows = [[{ id: 7 }], SIBLINGS];
    const res = await call('get', '/api/auth/family/{token}', { url: `/api/auth/family/${FAMILY_TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.body.children).toEqual(SIBLINGS);
  });

  it('404s an unknown family link', async () => {
    const res = await call('get', '/api/auth/family/{token}', { url: '/api/auth/family/not-a-token' });
    expect(res.status).toBe(404);
  });

  it('signs in as a child, accepting a numeric-string child_id', async () => {
    selectRows = [[{ id: 7 }], [CHILD_ROW]];
    const res = await call('post', '/api/auth/family-login', { body: { token: FAMILY_TOKEN, child_id: '11' } });
    expect(res.status).toBe(200);
    expect(res.body.user.family_mode).toBe(true);
  });

  it('keeps the family-login error messages', async () => {
    const bad = await call('post', '/api/auth/family-login', { body: { token: FAMILY_TOKEN, child_id: 0 } });
    expect(bad).toEqual({ status: 400, body: { error: 'Choose an adventurer.' } });
    const unknown = await call('post', '/api/auth/family-login', { body: { token: FAMILY_TOKEN, child_id: 11 } });
    expect(unknown.status).toBe(404);
    selectRows = [[{ id: 7 }]];
    const gone = await call('post', '/api/auth/family-login', { body: { token: FAMILY_TOKEN, child_id: 99 } });
    expect(gone).toEqual({ status: 404, body: { error: 'That adventurer is no longer in this family.' } });
  });

  it('lists siblings in family mode', async () => {
    selectRows = [[{ parentId: 7 }], SIBLINGS];
    const res = await call('get', '/api/auth/family-members', { token: familySession() });
    expect(res.status).toBe(200);
    expect(res.body.children).toHaveLength(2);
    expect((await call('get', '/api/auth/family-members', { token: childSession() })).status).toBe(403);
  });

  it('switches to a sibling', async () => {
    selectRows = [[{ parentId: 7 }], [{ ...CHILD_ROW, id: 12, username: 'ember' }]];
    const res = await call('post', '/api/auth/family-switch', { token: familySession(), body: { child_id: 12 } });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 12, family_mode: true });
  });

  it('checks family mode before the child id, as before', async () => {
    const outside = await call('post', '/api/auth/family-switch', { token: childSession(), body: {} });
    expect(outside.status).toBe(403);
    selectRows = [[{ parentId: 7 }]];
    const bad = await call('post', '/api/auth/family-switch', { token: familySession(), body: { child_id: -1 } });
    expect(bad).toEqual({ status: 400, body: { error: 'Choose an adventurer.' } });
    selectRows = [[{ parentId: 7 }]];
    const gone = await call('post', '/api/auth/family-switch', { token: familySession(), body: { child_id: 99 } });
    expect(gone.status).toBe(404);
  });
});

describe('kid profile routes', () => {
  it('lists the avatars', async () => {
    const res = await call('get', '/api/auth/avatars', { token: childSession() });
    expect(res.body.avatars).toEqual(authContract.ALLOWED_AVATARS);
    expect((await call('get', '/api/auth/avatars')).status).toBe(401);
  });

  it('lets a new child set a trimmed handle and avatar', async () => {
    const renamed = { ...CHILD_ROW, username: 'Blaze_9', avatar: '🦄' };
    selectRows = [[{ ...CHILD_ROW, needs_handle: true }], [], [renamed]];
    const res = await call('post', '/api/auth/child/handle', {
      token: familySession(),
      body: { username: '  Blaze_9 ', avatar: '🦄' },
    });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ username: 'Blaze_9', needsHandle: false, avatar: '🦄' }]);
    expect(res.body.user).toMatchObject({ username: 'Blaze_9', family_mode: true });
  });

  it('accepts a null avatar when setting a handle', async () => {
    selectRows = [[{ ...CHILD_ROW, needs_handle: true }], [], [CHILD_ROW]];
    const res = await call('post', '/api/auth/child/handle', {
      token: childSession(),
      body: { username: 'sparky', avatar: null },
    });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ username: 'sparky', needsHandle: false }]);
  });

  it('keeps the handle error messages', async () => {
    const needsHandle = () => { selectRows = [[{ ...CHILD_ROW, needs_handle: true }]]; };
    needsHandle();
    const short = await call('post', '/api/auth/child/handle', { token: childSession(), body: { username: 'x' } });
    expect(short).toEqual({ status: 400, body: { error: 'Handle must be 2–24 letters, numbers, _ or -' } });
    needsHandle();
    const avatar = await call('post', '/api/auth/child/handle', {
      token: childSession(),
      body: { username: 'sparky', avatar: '💀' },
    });
    expect(avatar).toEqual({ status: 400, body: { error: 'Invalid avatar' } });
    needsHandle();
    selectRows.push([{ id: 99 }]);
    const taken = await call('post', '/api/auth/child/handle', { token: childSession(), body: { username: 'ember' } });
    expect(taken.status).toBe(409);
    selectRows = [[CHILD_ROW]];
    const already = await call('post', '/api/auth/child/handle', { token: childSession(), body: { username: 'ember' } });
    expect(already.status).toBe(409);
    const adult = await call('post', '/api/auth/child/handle', {
      token: childSession({ id: 7, account_type: 'parent' }),
      body: { username: 'ember' },
    });
    expect(adult.status).toBe(403);
    const deleted = await call('post', '/api/auth/child/handle', { token: childSession(), body: { username: 'ember' } });
    expect(deleted.status).toBe(404);
  });

  it('updates avatar and font', async () => {
    selectRows = [[{ ...CHILD_ROW, avatar: '🦊', font: 'bubbly' }]];
    const res = await call('put', '/api/auth/profile', { token: childSession(), body: { avatar: '🦊', font: 'bubbly' } });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ avatar: '🦊', font: 'bubbly' }]);
    expect(res.body.user).toMatchObject({ avatar: '🦊', font: 'bubbly' });
  });

  it('keeps the profile error messages', async () => {
    const put = body => call('put', '/api/auth/profile', { token: childSession(), body });
    expect(await put({ avatar: 'nope' })).toEqual({ status: 400, body: { error: 'Invalid avatar' } });
    expect(await put({ avatar: null })).toEqual({ status: 400, body: { error: 'Invalid avatar' } });
    expect(await put({ font: 'comic' })).toEqual({ status: 400, body: { error: 'Invalid font' } });
    expect(await put({})).toEqual({ status: 400, body: { error: 'Nothing to update' } });
    expect(await put({ nickname: 'x' })).toEqual({ status: 400, body: { error: 'Nothing to update' } });
    expect(updates).toEqual([]);
    expect((await call('put', '/api/auth/profile', { body: { font: 'clean' } })).status).toBe(401);
  });
});

const APPLE_SUB = '001234.abcdef0123456789.0042';
const RELAY_EMAIL = 'x7k2m9q4pz@privaterelay.appleid.com';

// An identity token shaped like Apple's. `claims` override the defaults; the
// options pick the signing key id, issuer, audience and expiry (a JWT duration
// or an absolute time).
async function appleToken(claims = {}, {
  kid = 'apple-test-key',
  iss = 'https://appleid.apple.com',
  aud = 'com.example.dragonacademy',
  expiresIn = '10m',
} = {}) {
  return new SignJWT({ email: RELAY_EMAIL, email_verified: 'true', is_private_email: 'true', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(APPLE_SUB)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(appleKey.privateKey);
}

const APPLE_PARENT_ROW = {
  ...PARENT_ROW,
  id: 501,
  username: RELAY_EMAIL,
  email: RELAY_EMAIL,
  email_verified: false,
  apple_sub: APPLE_SUB,
  contact_email: null,
  contact_email_verified: false,
  plan: 'free',
};

const appleSignIn = body => call('post', '/api/auth/apple', { body });

describe('POST /api/auth/apple', () => {
  it('creates a new parent, keeping a private relay address as the login email only', async () => {
    selectRows = [[], [], [APPLE_PARENT_ROW]]; // by apple_sub, by email, the inserted row
    const res = await appleSignIn({ identity_token: await appleToken() });
    expect(res.status).toBe(200);
    expect(inserts).toEqual([{
      username: RELAY_EMAIL,
      accountType: 'parent',
      email: RELAY_EMAIL,
      appleSub: APPLE_SUB,
      emailVerified: false,
      contactEmail: null,
      contactEmailVerified: false,
    }]);
    expect(res.body.user).toMatchObject({
      id: 501,
      account_type: 'parent',
      email: RELAY_EMAIL,
      contact_email: null,
      contact_email_verified: false,
    });
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth.js');
    expect(jwt.verify(res.body.token, JWT_SECRET)).toMatchObject({ id: 501, account_type: 'parent', adult_role: 'parent' });
  });

  it('treats a relay domain as private even without the is_private_email flag', async () => {
    selectRows = [[], [], [APPLE_PARENT_ROW]];
    await appleSignIn({ identity_token: await appleToken({ is_private_email: undefined, email: RELAY_EMAIL.toUpperCase() }) });
    expect(inserts[0]).toMatchObject({ email: RELAY_EMAIL, contactEmail: null, contactEmailVerified: false });
  });

  it('makes a real, Apple-verified email the verified contact email too', async () => {
    const row = { ...APPLE_PARENT_ROW, username: 'pat@example.com', email: 'pat@example.com', email_verified: true, contact_email: 'pat@example.com', contact_email_verified: true };
    selectRows = [[], [], [row]];
    const res = await appleSignIn({ identity_token: await appleToken({ email: 'Pat@Example.com', is_private_email: false, email_verified: true }) });
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({
      username: 'pat@example.com',
      email: 'pat@example.com',
      emailVerified: true,
      contactEmail: 'pat@example.com',
      contactEmailVerified: true,
    });
    expect(res.body.user).toMatchObject({ contact_email: 'pat@example.com', contact_email_verified: true });
  });

  it('creates a parent Apple shared no email with', async () => {
    selectRows = [[], [{ ...APPLE_PARENT_ROW, username: `apple:${APPLE_SUB}`, email: null }]];
    const res = await appleSignIn({ identity_token: await appleToken({ email: undefined, email_verified: undefined, is_private_email: undefined }) });
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ username: `apple:${APPLE_SUB}`, email: null, contactEmail: null });
  });

  it('signs a returning parent in by Apple id without touching the account', async () => {
    selectRows = [[APPLE_PARENT_ROW]];
    const res = await appleSignIn({ identity_token: await appleToken() });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(501);
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('checks the nonce against the SHA-256 the client gave Apple', async () => {
    const raw = 'c2VjcmV0LW5vbmNl';
    const hashed = createHash('sha256').update(raw).digest('hex');
    selectRows = [[APPLE_PARENT_ROW]];
    const ok = await appleSignIn({ identity_token: await appleToken({ nonce: hashed }), nonce: raw });
    expect(ok.status).toBe(200);
    const replayed = await appleSignIn({ identity_token: await appleToken({ nonce: hashed }), nonce: 'another-sign-in' });
    expect(replayed).toEqual({ status: 401, body: { error: 'Could not verify Apple sign-in.' } });
  });

  it('attaches Apple to an existing verified account with the same real email', async () => {
    const existing = { ...PARENT_ROW, email: 'grownup@example.com', email_verified: true, apple_sub: null };
    selectRows = [[], [existing], [{ ...existing, apple_sub: APPLE_SUB }]];
    const res = await appleSignIn({ identity_token: await appleToken({ email: 'grownup@example.com', is_private_email: false }) });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ appleSub: APPLE_SUB }]);
    expect(inserts).toEqual([]);
    expect(res.body.user.id).toBe(7);
  });

  it('will not attach Apple to an account whose own email is unverified', async () => {
    selectRows = [[], [{ ...PARENT_ROW, email_verified: false, apple_sub: null }]];
    const res = await appleSignIn({ identity_token: await appleToken({ email: 'grownup@example.com', is_private_email: false }) });
    expect(res.status).toBe(409);
    expect(updates).toEqual([]);
  });

  it('409s a child account and a lost unique race', async () => {
    selectRows = [[{ ...CHILD_ROW, apple_sub: APPLE_SUB }]];
    expect((await appleSignIn({ identity_token: await appleToken() })).status).toBe(409);
    insertError = Object.assign(new Error('duplicate key'), { code: '23505' });
    selectRows = [[], [], []];
    expect((await appleSignIn({ identity_token: await appleToken() })).status).toBe(409);
  });

  it('rejects a token that is forged, expired, for another app or from another issuer', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    // Apple's signature over someone else's claims: swap in a payload naming another user.
    const [header, , signature] = (await appleToken()).split('.');
    const otherPayload = Buffer.from(JSON.stringify({ sub: 'someone-else' })).toString('base64url');
    const bad = [
      `${header}.${otherPayload}.${signature}`,
      await appleToken({}, { kid: 'a-key-apple-never-published' }),
      await appleToken({}, { expiresIn: past }),
      await appleToken({}, { aud: 'com.someone.else' }),
      await appleToken({}, { iss: 'https://evil.example.com' }),
      'not-a-jwt',
    ];
    for (const identity_token of bad) {
      expect(await appleSignIn({ identity_token })).toEqual({ status: 401, body: { error: 'Could not verify Apple sign-in.' } });
    }
    expect(inserts).toEqual([]);
  });

  it("502s when Apple's keys can't be fetched", async () => {
    const apple = require('../lib/appleIdentity.js');
    const token = await appleToken();
    apple.setAppleKeySet(async () => { throw new TypeError('fetch failed'); });
    const errorLog = console.error;
    console.error = () => {};
    try {
      expect((await appleSignIn({ identity_token: token })).status).toBe(502);
    } finally {
      console.error = errorLog;
      apple.setAppleKeySet(appleKeySet);
    }
  });

  it('accepts any configured client id', async () => {
    selectRows = [[APPLE_PARENT_ROW]];
    expect((await appleSignIn({ identity_token: await appleToken({}, { aud: 'com.example.web' }) })).status).toBe(200);
  });

  it('400s a missing token and 503s when no client id is configured', async () => {
    for (const body of [{}, { identity_token: '  ' }, { identity_token: 42 }]) {
      expect(await appleSignIn(body)).toEqual({ status: 400, body: { error: 'Apple sign-in did not send an identity token.' } });
    }
    const saved = process.env.APPLE_CLIENT_IDS;
    process.env.APPLE_CLIENT_IDS = ' , ';
    try {
      expect((await appleSignIn({ identity_token: await appleToken() })).status).toBe(503);
    } finally {
      process.env.APPLE_CLIENT_IDS = saved;
    }
  });
});

// Not in the auth contract (web-only routes), so called without expectContract.
describe('password and email changes on an account with no password', () => {
  const parentSession = () => signToken({ id: 7, username: 'grownup@example.com', account_type: 'parent', adult_role: 'parent' });
  async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${parentSession()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const changePassword = () => post('/api/auth/password/change', { currentPassword: '', newPassword: 'a-long-new-password' });
  const changeEmail = () => post('/api/auth/email/change', { newEmail: 'new@example.com', currentPassword: '' });

  it('names Apple for an Apple-only account', async () => {
    selectRows = [[{ ...APPLE_PARENT_ROW, google_sub: null }]];
    expect(await changePassword()).toEqual({ status: 400, body: { error: 'This account signs in with Apple, so it has no password to change.' } });
    selectRows = [[{ ...APPLE_PARENT_ROW, google_sub: null }]];
    expect(await changeEmail()).toEqual({ status: 400, body: { error: 'This account signs in with Apple, so its sign-in email comes from your Apple ID.' } });
  });

  it('keeps the Google wording for a Google-only account', async () => {
    const googleRow = { ...PARENT_ROW, google_sub: 'google-sub', apple_sub: null };
    selectRows = [[googleRow]];
    expect((await changePassword()).body.error).toBe('This account signs in with Google, so it has no password to change.');
    selectRows = [[googleRow]];
    expect((await changeEmail()).body.error).toBe('This account signs in with Google — change your email through your Google account.');
  });

  it('names both for an account linked to Google and Apple', async () => {
    const bothRow = { ...PARENT_ROW, google_sub: 'google-sub', apple_sub: APPLE_SUB };
    selectRows = [[bothRow]];
    expect((await changePassword()).body.error).toBe('This account signs in with Google or Apple, so it has no password to change.');
    selectRows = [[bothRow]];
    expect((await changeEmail()).body.error).toBe('This account signs in with Google or Apple, so its sign-in email comes from that account.');
  });
});

describe('coverage', () => {
  it("checks a successful response for every route in the auth contract", () => {
    const missing = authContract.routes
      .map(r => `${r.method} ${r.path} 200`)
      .filter(key => !checked.has(key));
    expect(missing).toEqual([]);
  });
});
