// Revoke a parent's Sign in with Apple grant when they delete their account
// (App Store Review Guideline 5.1.1(v); Apple's "Revoke tokens" REST endpoint).
//
// Apple revokes a refresh or access token, not a `sub`, and this server never
// keeps either: sign-in only verifies identity tokens (docs/APPLE_SIGN_IN.md).
// So the app re-authenticates with Apple at deletion time and sends the fresh
// one-time `authorization_code`; we trade it at /auth/token for a refresh token
// and immediately revoke that, which ends the app's grant for this Apple ID.
//
// Both calls authenticate with a client secret: a short-lived ES256 JWT signed
// with the team's Sign in with Apple private key. That key is configuration:
//
//   APPLE_TEAM_ID      the developer team id (the JWT's iss)
//   APPLE_KEY_ID       the key's id (the JWT header's kid)
//   APPLE_PRIVATE_KEY  the .p8 contents, PEM; literal "\n" escapes are accepted
//
// With any of them unset, revocation is skipped with a logged warning: the
// account is still deleted, only Apple's side is left for the parent to remove
// in Settings. Revocation is best-effort for the same reason — by the time it
// runs the account is already gone, so a failure is logged, never thrown.
//
// Tests swap the HTTP client with setAppleRevokeFetch(); nothing here needs a
// real Apple credential or network.
const { SignJWT, importPKCS8 } = require('jose');
const { APPLE_ISSUER } = require('./appleIdentity');

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
// Apple allows up to six months; the secret is minted per deletion, so minutes do.
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

let fetchImpl = null;

// Test seam: a fetch-compatible function to call instead of the global fetch.
// Pass null to go back to the real one.
function setAppleRevokeFetch(next) {
  fetchImpl = next;
}

// → { teamId, keyId, privateKey } when all three are set, else null. Read per
// call so tests (and a restart-free env change) see the current value.
function appleRevokeConfig(env = process.env) {
  const teamId = (env.APPLE_TEAM_ID || '').trim();
  const keyId = (env.APPLE_KEY_ID || '').trim();
  const privateKey = (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey };
}

async function appleClientSecret({ teamId, keyId, privateKey }, clientId, now = Date.now()) {
  const key = await importPKCS8(privateKey, 'ES256');
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CLIENT_SECRET_TTL_SECONDS)
    .setAudience(APPLE_ISSUER)
    .setSubject(clientId)
    .sign(key);
}

async function postForm(url, fields) {
  const doFetch = fetchImpl || globalThis.fetch;
  return doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  });
}

// Revoke the grant behind `authorizationCode`, issued to `clientId` (the aud of
// the identity token that came with it). → { revoked: true } or
// { revoked: false, reason: 'unconfigured' | 'no_code' | 'exchange_failed' | 'revoke_failed' }.
// Never throws.
async function revokeAppleAuthorization({ authorizationCode, clientId, config = appleRevokeConfig(), now } = {}) {
  if (!config) {
    console.warn('[apple] Sign in with Apple token not revoked: APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY are not all set.');
    return { revoked: false, reason: 'unconfigured' };
  }
  if (!authorizationCode || !clientId) {
    console.warn('[apple] Sign in with Apple token not revoked: the app sent no authorization code.');
    return { revoked: false, reason: 'no_code' };
  }

  let clientSecret;
  let token;
  try {
    clientSecret = await appleClientSecret(config, clientId, now);
    const res = await postForm(APPLE_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${body.error || ''}`.trim());
    token = body.refresh_token
      ? { token: body.refresh_token, hint: 'refresh_token' }
      : body.access_token ? { token: body.access_token, hint: 'access_token' } : null;
    if (!token) throw new Error('no token in the response');
  } catch (err) {
    console.warn('[apple] Sign in with Apple token not revoked: code exchange failed:', err.message);
    return { revoked: false, reason: 'exchange_failed' };
  }

  try {
    const res = await postForm(APPLE_REVOKE_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      token: token.token,
      token_type_hint: token.hint,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn('[apple] Sign in with Apple token not revoked: revoke failed:', err.message);
    return { revoked: false, reason: 'revoke_failed' };
  }
  return { revoked: true };
}

module.exports = {
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  appleClientSecret,
  appleRevokeConfig,
  revokeAppleAuthorization,
  setAppleRevokeFetch,
};
