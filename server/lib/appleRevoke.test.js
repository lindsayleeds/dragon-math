// Revoking a Sign in with Apple grant (server/lib/appleRevoke.js) against a
// stubbed fetch: the client secret Apple would check, the two form posts, and
// that every failure is swallowed and reported rather than thrown.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';

const require = createRequire(import.meta.url);
const {
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  appleRevokeConfig,
  revokeAppleAuthorization,
  setAppleRevokeFetch,
} = require('./appleRevoke.js');

let config;
let publicKey;

beforeAll(() => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  publicKey = pair.publicKey;
  config = {
    teamId: 'TEAM123456',
    keyId: 'KEY7654321',
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
});

afterEach(() => {
  setAppleRevokeFetch(null);
  vi.restoreAllMocks();
});

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Answers the token exchange and the revoke in turn; records what was posted.
function stubApple({ exchange = json(200, { access_token: 'at', refresh_token: 'rt' }), revoke = json(200, {}) } = {}) {
  const calls = [];
  setAppleRevokeFetch(async (url, init) => {
    calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(init.body)) });
    if (url === APPLE_TOKEN_URL) {
      if (exchange instanceof Error) throw exchange;
      return exchange;
    }
    if (url === APPLE_REVOKE_URL) return revoke;
    throw new Error(`unexpected ${url}`);
  });
  return calls;
}

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('appleRevokeConfig', () => {
  it('needs all three variables', () => {
    expect(appleRevokeConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K' })).toBeNull();
    expect(appleRevokeConfig({ APPLE_TEAM_ID: 'T', APPLE_PRIVATE_KEY: 'P' })).toBeNull();
    expect(appleRevokeConfig({})).toBeNull();
  });

  it('turns literal \\n escapes in the key back into newlines', () => {
    const got = appleRevokeConfig({ APPLE_TEAM_ID: ' T ', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: '-----BEGIN-----\\nabc\\n-----END-----\\n' });
    expect(got).toEqual({ teamId: 'T', keyId: 'K', privateKey: '-----BEGIN-----\nabc\n-----END-----' });
  });
});

describe('revokeAppleAuthorization', () => {
  it('trades the code for a refresh token and revokes it, with a client secret signed by the team key', async () => {
    const calls = stubApple();
    const now = Date.now();

    const result = await revokeAppleAuthorization({ authorizationCode: 'code-1', clientId: 'com.example.app', config, now });

    expect(result).toEqual({ revoked: true });
    expect(calls.map(c => c.url)).toEqual([APPLE_TOKEN_URL, APPLE_REVOKE_URL]);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0].form).toMatchObject({ client_id: 'com.example.app', code: 'code-1', grant_type: 'authorization_code' });
    expect(calls[1].form).toMatchObject({ client_id: 'com.example.app', token: 'rt', token_type_hint: 'refresh_token' });

    const secret = calls[0].form.client_secret;
    expect(calls[1].form.client_secret).toBe(secret);
    expect(decodeProtectedHeader(secret)).toEqual({ alg: 'ES256', kid: 'KEY7654321' });
    const { payload } = await jwtVerify(secret, publicKey, {
      issuer: 'TEAM123456',
      audience: 'https://appleid.apple.com',
      subject: 'com.example.app',
      currentDate: new Date(now),
    });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(15777000); // Apple's six-month cap
  });

  it('revokes the access token when Apple returns no refresh token', async () => {
    const calls = stubApple({ exchange: json(200, { access_token: 'at-only' }) });
    expect(await revokeAppleAuthorization({ authorizationCode: 'c', clientId: 'app', config })).toEqual({ revoked: true });
    expect(calls[1].form).toMatchObject({ token: 'at-only', token_type_hint: 'access_token' });
  });

  it('skips with a warning when the server has no Apple key configured', async () => {
    const calls = stubApple();
    const warn = quiet();
    const result = await revokeAppleAuthorization({ authorizationCode: 'c', clientId: 'app', config: null });
    expect(result).toEqual({ revoked: false, reason: 'unconfigured' });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('APPLE_TEAM_ID'));
  });

  it('skips with a warning when the app sent no code', async () => {
    const calls = stubApple();
    quiet();
    expect(await revokeAppleAuthorization({ clientId: 'app', config })).toEqual({ revoked: false, reason: 'no_code' });
    expect(calls).toEqual([]);
  });

  it.each([
    ['Apple refuses the code', { exchange: json(400, { error: 'invalid_grant' }) }, 'exchange_failed', 1],
    ['the exchange cannot reach Apple', { exchange: new Error('ECONNRESET') }, 'exchange_failed', 1],
    ['Apple answers with no token', { exchange: json(200, {}) }, 'exchange_failed', 1],
    ['the revoke fails', { revoke: json(503, {}) }, 'revoke_failed', 2],
  ])('reports, without throwing, when %s', async (_name, stub, reason, callCount) => {
    const calls = stubApple(stub);
    const warn = quiet();
    expect(await revokeAppleAuthorization({ authorizationCode: 'c', clientId: 'app', config })).toEqual({ revoked: false, reason });
    expect(calls).toHaveLength(callCount);
    expect(warn).toHaveBeenCalled();
  });

  it('reports a key it cannot use as a failed exchange', async () => {
    const calls = stubApple();
    quiet();
    const bad = { ...config, privateKey: 'not a key' };
    expect(await revokeAppleAuthorization({ authorizationCode: 'c', clientId: 'app', config: bad }))
      .toEqual({ revoked: false, reason: 'exchange_failed' });
    expect(calls).toEqual([]);
  });
});
