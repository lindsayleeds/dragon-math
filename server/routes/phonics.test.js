import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let executeRows;
let inserted;
let limiter;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = 'phonics-route-test-secret';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../middleware/auth') {
      return {
        requireAuth(req, _res, next) {
          req.user = { id: 17, account_type: 'child' };
          next();
        },
      };
    }
    if (request === '../lib/rateLimit') {
      return { rateLimit: (...args) => limiter(...args) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  dbModule.db.execute = async () => ({ rows: executeRows });
  dbModule.db.insert = () => ({
    values(rows) {
      inserted.push(...rows);
      return Promise.resolve();
    },
  });

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/phonics', require('./phonics.js'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  executeRows = [];
  inserted = [];
  limiter = async () => ({ allowed: true });
});

describe('phonics routes', () => {
  it('retains earned mastery when the latest evidence is old', async () => {
    const old = new Date('2024-01-01T00:00:00.000Z');
    executeRows = Array.from({ length: 6 }, (_, i) => ({
      elementKey: 'sh',
      mode: i < 3 ? 'choose' : 'type-it',
      correct: true,
      chosen: null,
      createdAt: old,
    }));

    const response = await fetch(`${baseUrl}/api/phonics/mastery`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.elements.sh).toMatchObject({ level: 'mastered', stale: true, attempts: 6 });
  });

  it('waits for the limiter and returns 429 without storing the round', async () => {
    let resolveLimit;
    let markLimiterCalled;
    let limiterArgs;
    const limiterCalled = new Promise((resolve) => { markLimiterCalled = resolve; });
    limiter = (args) => {
      limiterArgs = args;
      markLimiterCalled();
      return new Promise((resolve) => { resolveLimit = resolve; });
    };

    const request = fetch(`${baseUrl}/api/phonics/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempts: [{ element_key: 'sh', mode: 'choose', correct: true }] }),
    });
    await limiterCalled;
    expect(inserted).toEqual([]);
    expect(limiterArgs).toEqual({
      key: 'phonics-attempts:17',
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });

    resolveLimit({ allowed: false });
    const response = await request;
    expect(response.status).toBe(429);
    expect(inserted).toEqual([]);
  });

  it('stores a round, cleaning what it cannot use and refusing a bad key', async () => {
    const post = attempts => fetch(`${baseUrl}/api/phonics/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempts }),
    });

    const response = await post([
      { element_key: 'SH', mode: 'choose', correct: true, chosen: null, response_ms: 1840.6 },
      // No time (the prompt was replayed) stays no time rather than 0.
      { element_key: 'sh', mode: 'type-it', correct: false, chosen: 'x y', response_ms: null },
      { element_key: 'ch', mode: 'type-it', correct: false, chosen: 'sh', response_ms: -5 },
    ]);
    expect(await response.json()).toEqual({ saved: 3 });
    expect(inserted).toEqual([
      { userId: 17, elementKey: 'sh', mode: 'choose', correct: true, chosen: null, responseMs: 1841 },
      { userId: 17, elementKey: 'sh', mode: 'type-it', correct: false, chosen: null, responseMs: null },
      { userId: 17, elementKey: 'ch', mode: 'type-it', correct: false, chosen: 'sh', responseMs: null },
    ]);

    inserted = [];
    const bad = await post([{ element_key: 'sh', mode: 'choose', correct: true }, { element_key: '!', mode: 'choose' }]);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid element_key: !' });
    expect(inserted).toEqual([]);
  });
});
