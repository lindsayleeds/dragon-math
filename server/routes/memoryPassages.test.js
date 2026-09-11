import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let server;
let baseUrl;
let originalLoad;
let originalSelect;
let originalUpdate;
let selectRows;
let updateCalls;
let updateRows;
let currentUser;

function fakeSelect() {
  return {
    from() { return this; },
    where() { return this; },
    limit() { return Promise.resolve(selectRows.shift() ?? []); },
  };
}

function fakeUpdate() {
  updateCalls += 1;
  return {
    set() { return this; },
    where() { return this; },
    returning() { return Promise.resolve(updateRows); },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../middleware/auth') {
      return {
        requireAuth(req, _res, next) {
          req.user = currentUser;
          next();
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const dbModule = require('../db.js');
  originalSelect = dbModule.db.select;
  originalUpdate = dbModule.db.update;
  dbModule.db.select = fakeSelect;
  dbModule.db.update = fakeUpdate;

  const express = require('express');
  const router = require('./memoryPassages.js');
  const app = express();
  app.use(express.json());
  app.use('/api/memory-passages', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (originalLoad) Module._load = originalLoad;
  const dbModule = require('../db.js');
  dbModule.db.select = originalSelect;
  dbModule.db.update = originalUpdate;
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  selectRows = [];
  updateCalls = 0;
  updateRows = [];
  currentUser = { id: 11, account_type: 'child' };
});

describe('memory passage editing', () => {
  it('returns a conflict when the loaded revision loses a concurrent update', async () => {
    currentUser = { id: 21, account_type: 'parent' };
    selectRows.push(
      [{
        id: 9,
        childId: 11,
        title: 'Before',
        category: 'quote',
        body: 'Same wording.',
        masteryLevel: 3,
        updatedAt: new Date('2026-09-10T12:00:00.000Z'),
      }],
      [{ parentId: 21 }],
    );
    const response = await fetch(`${baseUrl}/api/memory-passages/9`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'After',
        category: 'quote',
        body: 'Same wording.',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This passage changed while it was being edited.',
      code: 'passage_changed',
    });
    expect(updateCalls).toBe(1);
  });
});

describe('memory passage progress', () => {
  it('rejects completion when the practiced wording is stale', async () => {
    selectRows.push([{
      id: 7,
      childId: 11,
      body: 'New wording.',
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
    }]);
    const response = await fetch(`${baseUrl}/api/memory-passages/7/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: 'hard',
        body: 'Old wording.',
        updated_at: '2026-09-10T11:00:00.000Z',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This passage changed while it was being practiced.',
      code: 'passage_changed',
    });
    expect(updateCalls).toBe(0);
  });

  it('rejects completion when wording changed away and back after practice began', async () => {
    selectRows.push([{
      id: 8,
      childId: 11,
      body: 'Same wording.',
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
    }]);
    const response = await fetch(`${baseUrl}/api/memory-passages/8/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: 'hard',
        body: 'Same wording.',
        updated_at: '2026-09-10T11:00:00.000Z',
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('passage_changed');
    expect(updateCalls).toBe(0);
  });
});
