import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let attempts;
let selectRows;

function fakeSelect() {
  return {
    from() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    orderBy() { return Promise.resolve(selectRows.shift() ?? []); },
    limit() { return Promise.resolve(selectRows.shift() ?? []); },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = 'family-route-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../middleware/auth') {
      return {
        JWT_SECRET: process.env.JWT_SECRET,
        requireAuth(req, _res, next) {
          req.user = { id: 11, account_type: 'child', family_parent_id: 7 };
          next();
        },
        requireParent: (_req, _res, next) => next(),
      };
    }
    if (request === '../lib/rateLimit') {
      return {
        rateLimit: async () => {
          attempts += 1;
          return { allowed: attempts <= 40 };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  dbModule.db.select = fakeSelect;

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
  attempts = 0;
  selectRows = [];
});

describe('family authentication routes', () => {
  it('rejects an unlinked family session before listing or switching siblings', async () => {
    const members = await fetch(`${baseUrl}/api/auth/family-members`, {
      headers: { Authorization: 'Bearer family-session' },
    });
    expect(members.status).toBe(403);

    const switched = await fetch(`${baseUrl}/api/auth/family-switch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer family-session',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ child_id: 12 }),
    });
    expect(switched.status).toBe(403);
    expect(selectRows).toEqual([]);
  });

  it('returns 429 after the family login attempt limit is exhausted', async () => {
    const login = () => fetch(`${baseUrl}/api/auth/family-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ child_id: 0, token: 'invalid' }),
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect((await login()).status).toBe(400);
    }
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(attempts).toBe(41);
  });
});
