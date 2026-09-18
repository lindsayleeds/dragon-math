import { beforeAll, afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('module');
const jwt = require('jsonwebtoken');
const secret = 'admin-test-secret';
let server, baseUrl, row, allowed, dbError, audit;
let originalSecret;

beforeAll(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const originalLoad = Module._load;
  const db = { select: () => ({ from() { return this; }, where() { return this; },
    async limit() { if (dbError) throw dbError; return row ? [row] : []; } }) };
  Module._load = function(request, parent, isMain) {
    if (request === '../db') return { db, schema: require('../db/schema') };
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const express = require('express');
    const app = express();
    app.get('/api/admin/check', require('./admin').requireAdmin, (_req, res) => res.json({ ok: true }));
    app.use((err, _req, res, next) => { void next; res.status(500).json({ error: err.message }); });
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  } finally { Module._load = originalLoad; }
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
beforeEach(() => {
  row = { id: 1, accountType: 'admin' };
  allowed = true;
  dbError = null;
  audit = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function get(type = 'admin', id = 1, options = {}) {
  const token = jwt.sign({ id, account_type: type }, secret, options);
  return fetch(`${baseUrl}/api/admin/check`, { headers: { Authorization: `Bearer ${token}` } });
}
describe('admin sessions', () => {
  it('rejects the old shared password and missing sessions', async () => {
    const res = await fetch(`${baseUrl}/api/admin/check`, { headers: { 'x-admin-password': 'dragon' } });
    expect(res.status).toBe(401);
  });
  it.each(['parent', 'child', 'guest'])('rejects %s even when the database role was promoted', async type => {
    expect((await get(type)).status).toBe(403);
  });
  it('rejects expired sessions', async () => {
    expect((await get('admin', 1, { expiresIn: -1 })).status).toBe(401);
  });
  it('allows multiple admins and records the actor', async () => {
    expect((await get()).status).toBe(200);
    row = { id: 2, accountType: 'admin' };
    expect((await get('admin', 2)).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.stringContaining('"actorId":2'));
  });
  it('revokes an existing session immediately after demotion or deletion', async () => {
    expect((await get()).status).toBe(200);
    row.accountType = 'parent';
    expect((await get()).status).toBe(403);
    row = null;
    expect((await get()).status).toBe(403);
  });
  it('fails closed on database errors', async () => {
    dbError = new Error('database unavailable');
    expect((await get()).status).toBe(500);
  });
  it('rate limits admin sessions', async () => {
    allowed = false;
    expect((await get()).status).toBe(429);
  });
});
