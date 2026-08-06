// requireAdmin is the only thing standing in front of /admin — the full roster of
// parents and children, per-child analytics, kid login tokens, plan overrides and
// the billing funnel. These tests pin the three properties that were wrong or
// missing before:
//
//   1. no default password. It used to be `process.env.ADMIN_PASSWORD || 'dragon'`,
//      so a box that never set the variable served the admin surface behind a word
//      committed to this repo — and passed every deploy check while doing it.
//   2. a brute-force ceiling. There was none: /api/admin/check accepted unlimited
//      guesses.
//   3. constant-time comparison, so a wrong password cannot be narrowed down by
//      timing the response.
//
// admin.js is CommonJS and requires ../lib/rateLimit at load, which requires ../db
// — wired up the plain Node way rather than with vi.mock, per AGENTS.md.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let requireAdmin;
let originalLoad;
let originalAdminPassword;
let limiter; // swappable fake for rateLimit

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

// A request carrying a password and an IP, shaped the way express presents them.
function makeReq(password, ip = '10.0.0.1') {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: password === undefined ? {} : { 'x-admin-password': password },
  };
}

async function run(req) {
  const res = makeRes();
  let nexted = false;
  await requireAdmin(req, res, () => { nexted = true; });
  return { res, nexted };
}

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  originalAdminPassword = process.env.ADMIN_PASSWORD;

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    // The limiter's own behaviour is covered by rateLimit.test.js; here it only
    // needs to be controllable, and must never touch a database.
    if (request === '../lib/rateLimit') {
      return { rateLimit: (...args) => limiter(...args) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  ({ requireAdmin } = require('./admin.js'));
});

afterAll(() => {
  if (originalLoad) Module._load = originalLoad;
  if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = originalAdminPassword;
});

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'correct-horse-battery';
  limiter = async () => ({ allowed: true, remaining: 99 });
});

describe('requireAdmin — missing configuration', () => {
  it('refuses every request with 503 when ADMIN_PASSWORD is unset', async () => {
    delete process.env.ADMIN_PASSWORD;
    const { res, nexted } = await run(makeReq('dragon'));
    expect(res.statusCode).toBe(503);
    expect(nexted).toBe(false);
  });

  it('does not accept the old default password', async () => {
    // The regression that mattered: 'dragon' was the fallback, so it must not
    // work when nothing is configured.
    delete process.env.ADMIN_PASSWORD;
    const { nexted } = await run(makeReq('dragon'));
    expect(nexted).toBe(false);
  });

  it('treats an empty ADMIN_PASSWORD as unset, not as a password', async () => {
    // Otherwise `ADMIN_PASSWORD=` in shared/.env would admit a request that sent
    // an empty header.
    process.env.ADMIN_PASSWORD = '';
    const { res, nexted } = await run(makeReq(''));
    expect(res.statusCode).toBe(503);
    expect(nexted).toBe(false);
  });
});

describe('requireAdmin — authentication', () => {
  it('admits the correct password', async () => {
    const { nexted } = await run(makeReq('correct-horse-battery'));
    expect(nexted).toBe(true);
  });

  it('rejects a wrong password with 401', async () => {
    const { res, nexted } = await run(makeReq('wrong'));
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it('rejects a missing header', async () => {
    const { res, nexted } = await run(makeReq(undefined));
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it('rejects a correct prefix — no partial credit', async () => {
    const { nexted } = await run(makeReq('correct-horse'));
    expect(nexted).toBe(false);
  });

  it('rejects a non-string header without throwing', async () => {
    // An array arrives when the header is sent twice; timingSafeEqual on a
    // non-string would throw and surface as a 500.
    const req = makeReq(undefined);
    req.headers['x-admin-password'] = ['correct-horse-battery', 'x'];
    const { res, nexted } = await run(req);
    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });
});

describe('requireAdmin — brute-force ceiling', () => {
  it('counts every attempt against the caller IP', async () => {
    const calls = [];
    limiter = async (opts) => { calls.push(opts); return { allowed: true, remaining: 1 }; };
    await run(makeReq('whatever', '203.0.113.7'));
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('admin-auth:203.0.113.7');
    expect(calls[0].limit).toBeGreaterThan(0);
    expect(calls[0].windowMs).toBeGreaterThan(0);
  });

  it('returns 429 once the limit is exceeded', async () => {
    limiter = async () => ({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    const { res, nexted } = await run(makeReq('wrong'));
    expect(res.statusCode).toBe(429);
    expect(nexted).toBe(false);
  });

  it('blocks even a CORRECT password once the limit is exceeded', async () => {
    // The property that makes the ceiling real: if the limiter were consulted
    // only on failure, an attacker already over the limit would still be let
    // through the moment they guessed right.
    limiter = async () => ({ allowed: false, remaining: 0 });
    const { res, nexted } = await run(makeReq('correct-horse-battery'));
    expect(res.statusCode).toBe(429);
    expect(nexted).toBe(false);
  });

  it('does not consult the limiter when the password is unconfigured', async () => {
    // Nothing to brute-force, and no reason to write a row per request.
    delete process.env.ADMIN_PASSWORD;
    let called = 0;
    limiter = async () => { called += 1; return { allowed: true }; };
    await run(makeReq('dragon'));
    expect(called).toBe(0);
  });
});
