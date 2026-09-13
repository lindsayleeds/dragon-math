// /api/api-keys — key management, driven through a real Express app.
//
// CommonJS, so `../db` and `../lib/rateLimit` are wired the plain Node way
// rather than with vi.mock (see AGENTS.md and billing.portal.test.js). No
// database is touched.
//
// The load-bearing test in this file is "a key cannot mint a key". Everything
// else here is ordinary CRUD; that one is what keeps a leaked key containable,
// because signing in is the only recovery path and a key that could issue or
// delete keys would take it away.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

// Models the four statement shapes routes/apiKeys.js issues.
function makeFakeDb() {
  const state = { selectRows: [], inserts: [], deletes: [], deleteReturns: [] };
  return {
    state,
    db: {
      select() {
        const chain = {
          from() { return this; },
          innerJoin() { return this; },
          where() { return this; },
          limit() { return Promise.resolve(state.selectRows.shift() ?? []); },
          orderBy() { return Promise.resolve(state.selectRows.shift() ?? []); },
          // The count query ends at .where(), so the chain has to be awaitable.
          then(onOk, onErr) {
            return Promise.resolve(state.selectRows.shift() ?? []).then(onOk, onErr);
          },
        };
        return chain;
      },
      insert() {
        const rec = {};
        return {
          values(v) { rec.values = v; return this; },
          returning() {
            state.inserts.push(rec);
            return Promise.resolve([{
              id: 42,
              name: rec.values.name,
              prefix: rec.values.prefix,
              lastUsedAt: null,
              createdAt: new Date('2026-09-13T00:00:00Z'),
            }]);
          },
        };
      },
      delete() {
        const rec = {};
        return {
          where() { state.deletes.push(rec); return this; },
          returning() { return Promise.resolve(state.deleteReturns.shift() ?? []); },
        };
      },
    },
  };
}

let server;
let baseUrl;
let fake;
let originalLoad;
let sessionUser;   // what the faked requireAuth publishes, or null for no session

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = 'test-secret-not-a-real-one';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/rateLimit') {
      return { rateLimit: async () => ({ allowed: true, remaining: 99 }) };
    }
    if (request === '../middleware/auth') {
      // Test doubles only — the real requireAuth/requireParent are untouched.
      // requireAuth stands in for "a valid session was presented"; the point of
      // faking it is that the routes' own gating is what's under test.
      const real = originalLoad.call(this, request, parent, isMain);
      return {
        ...real,
        requireAuth: (req, res, next) => {
          if (!sessionUser) return res.status(401).json({ error: 'Missing or malformed Authorization header' });
          req.user = sessionUser;
          next();
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  fake = makeFakeDb();
  const dbModule = require('../db.js');
  dbModule.db.select = fake.db.select;
  dbModule.db.insert = fake.db.insert;
  dbModule.db.delete = fake.db.delete;

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/api-keys', require('./apiKeys.js'));

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  fake.state.selectRows = [];
  fake.state.inserts = [];
  fake.state.deletes = [];
  fake.state.deleteReturns = [];
  sessionUser = { id: 501, username: 'grownup', account_type: 'parent', adult_role: 'parent' };
});

const call = (path, options = {}) => fetch(`${baseUrl}/api/api-keys${path}`, {
  headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  ...options,
});

describe('POST /api/api-keys', () => {
  it('mints a key and returns the plaintext exactly once', async () => {
    fake.state.selectRows = [[{ count: 0 }]];
    const res = await call('', { method: 'POST', body: JSON.stringify({ name: 'Weekly import' }) });
    expect(res.status).toBe(201);
    const body = await res.json();

    const { TOKEN_PREFIX, hashToken } = require('../lib/apiKeys.js');
    expect(body.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(body.key.prefix).toBe(body.token.slice(0, body.key.prefix.length));

    // The stored row must carry the hash and never the token — the property
    // that makes a database leak survivable.
    const stored = fake.state.inserts[0].values;
    expect(stored.tokenHash).toBe(hashToken(body.token));
    expect(JSON.stringify(stored)).not.toContain(body.token);
    // Nor may the listed key ever echo it back.
    expect(JSON.stringify(body.key)).not.toContain(body.token);
    expect(stored.userId).toBe(501);
  });

  it('rejects a nameless key', async () => {
    const res = await call('', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(fake.state.inserts).toHaveLength(0);
  });

  it('refuses to go past the per-account cap', async () => {
    const { MAX_KEYS_PER_USER } = require('../lib/apiKeys.js');
    fake.state.selectRows = [[{ count: MAX_KEYS_PER_USER }]];
    const res = await call('', { method: 'POST', body: JSON.stringify({ name: 'One too many' }) });
    expect(res.status).toBe(400);
    expect(fake.state.inserts).toHaveLength(0);
  });

  it('refuses a child account', async () => {
    sessionUser = { id: 7, username: 'kid', account_type: 'child', adult_role: 'parent' };
    const res = await call('', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) });
    expect(res.status).toBe(403);
    expect(fake.state.inserts).toHaveLength(0);
  });
});

// THE containment property. If any of these three stop being session-only, a
// leaked key can issue itself replacements and delete the key whose revocation
// would have stopped it — and revoking becomes impossible.
describe('a key cannot manage keys', () => {
  const token = 'dmk_' + 'a'.repeat(64);

  it('will not mint a key', async () => {
    sessionUser = null;
    const res = await call('', {
      method: 'POST',
      headers: { 'x-api-key': token },
      body: JSON.stringify({ name: 'Bootstrapped' }),
    });
    expect(res.status).toBe(401);
    expect(fake.state.inserts).toHaveLength(0);
  });

  it('will not list keys', async () => {
    sessionUser = null;
    const res = await call('', { headers: { 'x-api-key': token } });
    expect(res.status).toBe(401);
  });

  it('will not delete a key', async () => {
    sessionUser = null;
    const res = await call('/42', { method: 'DELETE', headers: { 'x-api-key': token } });
    expect(res.status).toBe(401);
    expect(fake.state.deletes).toHaveLength(0);
  });
});

describe('GET /api/api-keys', () => {
  it('lists the caller keys without any secret', async () => {
    fake.state.selectRows = [[
      { id: 1, name: 'Laptop', prefix: 'dmk_11112222', lastUsedAt: null, createdAt: new Date() },
    ]];
    const res = await call('');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(Object.keys(body.keys[0]).sort())
      .toEqual(['created_at', 'id', 'last_used_at', 'name', 'prefix']);
  });
});

describe('DELETE /api/api-keys/:keyId', () => {
  it('revokes a key the caller owns', async () => {
    fake.state.deleteReturns = [[{ id: 42 }]];
    const res = await call('/42', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // Scoped by owner in the statement itself, so someone else's id is a 404 —
  // which also declines to confirm that the id exists.
  it('404s an id that is not the caller own', async () => {
    fake.state.deleteReturns = [[]];
    const res = await call('/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id', async () => {
    const res = await call('/abc', { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(fake.state.deletes).toHaveLength(0);
  });
});
