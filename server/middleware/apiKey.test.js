// The authorisation boundary for parent API keys, driven through a real Express
// app over a real socket.
//
// apiKey.js is CommonJS and destructures `../db` at require time, so `../db` and
// `../lib/rateLimit` are wired the plain Node way rather than with vi.mock
// (which does not intercept require() inside a CJS module) — see the note in
// AGENTS.md and routes/billing.portal.test.js. Nothing here touches a database.
//
// What these pin, in rough order of how bad the regression would be:
//  - a key resolves to its OWNER, never to whoever the request names;
//  - an unknown, malformed or child-owned key cannot authenticate;
//  - a session still works unchanged, and is still what an absent credential
//    is judged against;
//  - the limiter is consulted before the key is looked up, so a flood costs one
//    statement rather than two.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

// --- fakes -----------------------------------------------------------------

// Models the one SELECT the middleware makes (key joined to its owner) and the
// one UPDATE it may make (last_used_at), recording both.
function makeFakeDb() {
  const state = { row: null, selects: 0, updates: [] };
  return {
    state,
    db: {
      select() {
        return {
          from() { return this; },
          innerJoin() { return this; },
          where() { return this; },
          limit() {
            state.selects += 1;
            return Promise.resolve(state.row ? [state.row] : []);
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
    },
  };
}

let server;
let baseUrl;
let fake;
let originalLoad;
let rateLimitCalls;
let rateLimitAllowed;
let apiKeys;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = 'test-secret-not-a-real-one';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') {
      return {
        rateLimit: async (opts) => {
          rateLimitCalls.push(opts);
          return { allowed: rateLimitAllowed, remaining: 0 };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  fake = makeFakeDb();
  const dbModule = require('../db.js');
  dbModule.db.select = fake.db.select;
  dbModule.db.update = fake.db.update;

  apiKeys = require('../lib/apiKeys.js');
  const { authenticateWithApiKey } = require('./apiKey.js');

  const express = require('express');
  const app = express();
  app.use(express.json());
  // A stand-in for the routers this middleware actually fronts: it echoes back
  // exactly what the middleware decided, which is the thing under test.
  app.get('/probe', authenticateWithApiKey, (req, res) => {
    res.json({ user: req.user, apiKey: req.apiKey ?? null });
  });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  fake.state.row = null;
  fake.state.selects = 0;
  fake.state.updates = [];
  rateLimitCalls = [];
  rateLimitAllowed = true;
});

const probe = (headers = {}) => fetch(`${baseUrl}/probe`, { headers });

// A stored key row as the middleware's SELECT would return it.
function keyRow(over = {}) {
  return {
    keyId: 7,
    keyName: 'Weekly import',
    prefix: 'dmk_abcd1234',
    lastUsedAt: null,
    userId: 501,
    username: 'grownup',
    accountType: 'parent',
    adultRole: 'parent',
    ...over,
  };
}

describe('authenticating with an API key', () => {
  it('resolves the key to its owner', async () => {
    fake.state.row = keyRow();
    const token = apiKeys.generateToken().token;

    const res = await probe({ 'x-api-key': token });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The user shape must match what requireAuth publishes from a JWT, or the
    // ownership checks downstream read undefined and silently change meaning.
    expect(body.user).toEqual({
      id: 501,
      username: 'grownup',
      account_type: 'parent',
      adult_role: 'parent',
    });
    expect(body.apiKey).toEqual({ id: 7, name: 'Weekly import', prefix: 'dmk_abcd1234' });
  });

  it('accepts the key as a Bearer token too', async () => {
    fake.state.row = keyRow();
    const res = await probe({ authorization: `Bearer ${apiKeys.generateToken().token}` });
    expect(res.status).toBe(200);
  });

  // The identity comes from the row the hash found — nothing a caller sends can
  // steer it. This is the whole boundary in one assertion.
  it('ignores any identity the caller tries to assert alongside the key', async () => {
    fake.state.row = keyRow({ userId: 501 });
    const res = await probe({
      'x-api-key': apiKeys.generateToken().token,
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.forged.sig',
    });
    const body = await res.json();
    expect(body.user.id).toBe(501);
  });

  it('rejects a key with no matching row', async () => {
    fake.state.row = null;
    const res = await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid API key');
  });

  // A malformed key must not cost a round trip, and must not be reported
  // differently from an unknown one.
  it('rejects a malformed key without querying', async () => {
    const res = await probe({ 'x-api-key': 'dmk_not-a-real-token' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid API key');
    expect(fake.state.selects).toBe(0);
  });

  // Keys are only ever issued to grown-ups, and the live row is re-checked
  // rather than trusted from issue time — so an account that changed type stops
  // working immediately.
  it('refuses a key whose owner is not a grown-up account', async () => {
    fake.state.row = keyRow({ accountType: 'child' });
    const res = await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(res.status).toBe(403);
  });

  it('preserves the owner adult_role so teacher accounts are not silently promoted', async () => {
    fake.state.row = keyRow({ adultRole: 'teacher' });
    const res = await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect((await res.json()).user.adult_role).toBe('teacher');
  });
});

describe('falling through to the session', () => {
  // A browser sends no key, so it must reach requireAuth untouched — including
  // requireAuth's own message, which tells a person to sign in rather than
  // talking about API keys they do not have.
  it('hands a credential-free request to requireAuth', async () => {
    const res = await probe();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Missing or malformed Authorization header');
    expect(fake.state.selects).toBe(0);
    expect(rateLimitCalls).toHaveLength(0);
  });

  it('lets a real session through', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: 900, username: 'parent', account_type: 'parent', adult_role: 'parent' },
      process.env.JWT_SECRET,
    );
    const res = await probe({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(900);
    // No key answered, so handlers can tell a scripted call from a browser one.
    expect(body.apiKey).toBeNull();
  });
});

describe('rate limiting', () => {
  it('counts key requests and stops them when over', async () => {
    rateLimitAllowed = false;
    fake.state.row = keyRow();
    const res = await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(res.status).toBe(429);
    // Consulted BEFORE the lookup, so a flood costs one statement, not two.
    expect(fake.state.selects).toBe(0);
    expect(rateLimitCalls[0]).toMatchObject({ limit: 600, windowMs: 15 * 60 * 1000 });
    expect(rateLimitCalls[0].key.startsWith('apikey-auth:')).toBe(true);
  });
});

describe('last_used_at', () => {
  it('is written when the key has never been used', async () => {
    fake.state.row = keyRow({ lastUsedAt: null });
    await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].patch.lastUsedAt).toBeInstanceOf(Date);
  });

  // The reason it is throttled: a bulk import is one statement per request, not
  // two. The column only exists so a person can spot a key they don't recognise.
  it('is not rewritten for a key used moments ago', async () => {
    fake.state.row = keyRow({ lastUsedAt: new Date() });
    await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(fake.state.updates).toHaveLength(0);
  });

  it('is refreshed once the throttle window has passed', async () => {
    const { LAST_USED_REFRESH_MS } = require('./apiKey.js');
    fake.state.row = keyRow({ lastUsedAt: new Date(Date.now() - LAST_USED_REFRESH_MS - 1000) });
    await probe({ 'x-api-key': apiKeys.generateToken().token });
    expect(fake.state.updates).toHaveLength(1);
  });
});
