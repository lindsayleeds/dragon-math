import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('module');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
let server, baseUrl, user, googleVerified;
const secret = 'admin-login-test-secret';
beforeAll(async () => {
  process.env.JWT_SECRET = secret;
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../db') return {
      schema: require('../db/schema'),
      db: { select: () => ({ from() { return this; }, where() { return this; }, limit: async () => [user] }) },
    };
    if (request === '../lib/rateLimit') return { rateLimit: async () => ({ allowed: true }) };
    if (request === 'google-auth-library') return { OAuth2Client: class {
      async verifyIdToken() { return { getPayload: () => ({ sub: 'google-id', email: user.email, email_verified: googleVerified }) }; }
    } };
    return original.call(this, request, parent, isMain);
  };
  try {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('./auth'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  } finally { Module._load = original; }
});
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
  user = { id: 1, username: 'admin', account_type: 'admin', email: 'admin@example.test',
    email_verified: true, password_hash: bcrypt.hashSync('test-password', 4) };
  googleVerified = true;
});
function post(path, body) {
  return fetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
describe('admin login', () => {
  it('issues an admin JWT and adult profile on password login', async () => {
    const res = await post('/parent/login', { email: user.email, password: 'test-password' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ account_type: 'admin', email: user.email });
    expect(body.user.password_hash).toBeUndefined();
    expect(jwt.verify(body.token, secret).account_type).toBe('admin');
  });
  it('rejects wrong passwords', async () => {
    expect((await post('/parent/login', { email: user.email, password: 'wrong' })).status).toBe(401);
  });
  it('accepts verified Google sign-in without changing the admin role', async () => {
    const res = await post('/google', { idToken: 'verified-by-fake-google' });
    expect(res.status).toBe(200);
    expect((await res.json()).user.account_type).toBe('admin');
  });
  it('rejects Google identity without a verified email', async () => {
    googleVerified = false;
    expect((await post('/google', { idToken: 'unverified' })).status).toBe(401);
  });
  it('cannot exchange a permanent login link for an admin session', async () => {
    expect((await post('/child-login', { token: '00000000-0000-4000-8000-000000000001' })).status).toBe(403);
  });
});
