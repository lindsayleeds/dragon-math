// Verify a Sign in with Apple identity token (docs/adr/0007).
//
// The token is a JWT Apple signs with one of the keys it publishes at
// APPLE_JWKS_URL. It is genuine when the signature checks against that key set,
// `iss` is Apple, `aud` is one of our client ids and it has not expired; if the
// client sent a nonce, the token must also carry it (hashed — see below).
//
// Our client ids come from APPLE_CLIENT_IDS, a comma-separated list: the iOS
// bundle id, plus the web Services ID once the web offers Apple sign-in (#154).
// Read per call so tests (and a restart-free env change) see the current value.
//
// The key set is fetched lazily and cached by jose's createRemoteJWKSet: it keeps
// the keys for 10 minutes and refetches early (at most every 30s) when a token
// names a key id it has not seen, which is how Apple's key rotation is picked up.
// Tests swap it for a local key set with setAppleKeySet(); nothing here needs a
// real Apple credential.
const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { isPrivateRelayEmail } = require('./contactEmail');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

let keySet = null;

function appleKeySet() {
  if (!keySet) keySet = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return keySet;
}

// Test seam: a jose key set (e.g. createLocalJWKSet) to verify against instead
// of Apple's. Pass null to go back to the real, lazily fetched one.
function setAppleKeySet(next) {
  keySet = next;
}

function appleClientIds() {
  return (process.env.APPLE_CLIENT_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

// A token that is not genuine, not for us, expired or for another nonce. The
// route answers 401. Anything else thrown by verifyAppleIdentityToken (Apple's
// key endpoint unreachable or returning garbage) is an upstream failure.
class InvalidAppleTokenError extends Error {}

// jose error codes that mean "this token is bad", as opposed to "we could not
// get Apple's keys".
const INVALID_TOKEN_CODES = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
]);

// Apple sends these booleans as either true or "true".
const claimTrue = value => value === true || value === 'true';

// The client generates a random raw nonce, hands Apple its SHA-256 (hex) in the
// authorization request, and sends us the RAW value. So the token's `nonce`
// claim must equal sha256(raw) — a replayed token from another sign-in carries a
// different hash.
function nonceHash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// → { sub, email, emailVerified, isPrivateEmail } for a genuine token.
// email is lowercased, or null when the parent did not share one. isPrivateEmail
// is true for a relay address, whether Apple flagged it or only the domain says so.
async function verifyAppleIdentityToken(identityToken, { nonce, clientIds = appleClientIds() } = {}) {
  if (clientIds.length === 0) throw new Error('APPLE_CLIENT_IDS is not configured');

  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, appleKeySet(), {
      issuer: APPLE_ISSUER,
      audience: clientIds,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
    }));
  } catch (err) {
    if (INVALID_TOKEN_CODES.has(err?.code)) throw new InvalidAppleTokenError(err.code);
    throw err;
  }

  if (nonce !== undefined && payload.nonce !== nonceHash(nonce)) {
    throw new InvalidAppleTokenError('nonce mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new InvalidAppleTokenError('missing sub');

  const email = typeof payload.email === 'string' && payload.email ? payload.email.trim().toLowerCase() : null;
  return {
    sub: payload.sub,
    email,
    emailVerified: !!email && claimTrue(payload.email_verified),
    isPrivateEmail: !!email && (claimTrue(payload.is_private_email) || isPrivateRelayEmail(email)),
  };
}

module.exports = {
  APPLE_ISSUER,
  APPLE_JWKS_URL,
  InvalidAppleTokenError,
  appleClientIds,
  isPrivateRelayEmail,
  nonceHash,
  setAppleKeySet,
  verifyAppleIdentityToken,
};
