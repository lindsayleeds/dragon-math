import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('module');
let server, baseUrl, child, transactions;
beforeAll(async () => {
  process.env.JWT_SECRET = 'reset-test-secret';
  const original = Module._load;
  const mutation = { where() { return this; }, returning: async () => [], set() { return this; } };
  const db = {
    select: () => ({ from() { return this; }, where() { return this; }, limit: async () => child ? [child] : [] }),
    async transaction(fn) { transactions++; return fn({ delete: () => mutation, update: () => mutation }); },
  };
  Module._load = function(request, parent, isMain) {
    if (request === '../db') return { db, schema: require('../db/schema') };
    if (request === '../middleware/admin') return { requireAdmin(req, _res, next) { req.user = { id: 99, account_type: 'admin' }; next(); } };
    return original.call(this, request, parent, isMain);
  };
  try {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('./admin'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/reset-progress`;
  } finally { Module._load = original; }
});
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { child = { username: 'selected-child' }; transactions = 0; });
function reset(body) { return fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
describe('admin progress reset', () => {
  it('requires an explicit child instead of resetting the admin actor', async () => {
    expect((await reset({})).status).toBe(400);
    expect(transactions).toBe(0);
    const res = await reset({ userId: 12 });
    expect(res.status).toBe(200);
    expect((await res.json()).username).toBe('selected-child');
    expect(transactions).toBe(1);
  });
  it('does not modify anything when the child lookup fails', async () => {
    child = null;
    expect((await reset({ userId: 99 })).status).toBe(404);
    expect(transactions).toBe(0);
  });
});
