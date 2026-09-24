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
      return { ...real, effectivePlanForChild: async () => 'free' };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;
  dbModule.db.update = fakeUpdate;

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
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectRows = [];
  updates = [];
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

describe('coverage', () => {
  it("checks a successful response for every route in the auth contract", () => {
    const missing = authContract.routes
      .map(r => `${r.method} ${r.path} 200`)
      .filter(key => !checked.has(key));
    expect(missing).toEqual([]);
  });
});
