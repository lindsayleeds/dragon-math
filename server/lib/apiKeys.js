// Token format, hashing and validation for parent API keys. Deliberately pure —
// no database, no Express — so the rules below can be tested directly rather
// than through a route (see the note on server/lib/stripeCustomers.js in
// AGENTS.md). The database work lives in server/middleware/apiKey.js and
// server/routes/apiKeys.js.

const crypto = require('crypto');

// Namespaced so a leaked token is identifiable on sight — the point of the
// prefix convention is that secret scanners can match `dmk_`, and that this
// server can tell a key from a session in one comparison (a JWT is base64url of
// a JSON header, so it always starts `eyJ`).
const TOKEN_PREFIX = 'dmk_';

// 32 bytes = 256 bits. Guessing is not a threat model at this width, which is
// why the limiter in the middleware is about cost control rather than brute
// force, and why a fast hash is the right store (see schema.js).
const SECRET_BYTES = 32;

// How much of the token is echoed back as the non-secret label. 8 hex chars is
// 4 bytes — plenty to tell your own keys apart, far too little to be worth
// guessing the remaining 28 bytes from.
const PREFIX_CHARS = 8;

const MAX_KEYS_PER_USER = 10;
const MAX_NAME_LEN = 60;

// Hex rather than base64url so a token pastes through shells, CI variables and
// spreadsheets with no encoding surprises.
const SECRET_RE = new RegExp(`^${TOKEN_PREFIX}[0-9a-f]{${SECRET_BYTES * 2}}$`);

// Control characters, which would break the dashboard's rendering if they
// reached it inside a key name.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function displayPrefix(token) {
  return String(token).slice(0, TOKEN_PREFIX.length + PREFIX_CHARS);
}

function generateToken() {
  const secret = crypto.randomBytes(SECRET_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX}${secret}`;
  return { token, prefix: displayPrefix(token), tokenHash: hashToken(token) };
}

function looksLikeApiKey(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

// Which credential is this request presenting?
//
// Two spellings are accepted because both are normal: `X-API-Key` is what most
// scripting clients reach for, and `Authorization: Bearer` is what an HTTP
// library sets by default. They cannot be confused with a session — a JWT never
// starts with `dmk_` — so `Bearer` stays unambiguous.
//
// Returns the presented key, or null to mean "this is not an API-key request",
// which is how the middleware knows to fall through to the session path. A
// malformed `X-API-Key` still returns its string rather than null, so a typo'd
// key earns a 401 that says the key is bad instead of the session path's
// "missing Authorization header".
function extractPresentedKey(headers = {}) {
  const direct = headers['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const value = auth.slice(7).trim();
    if (looksLikeApiKey(value)) return value;
  }
  return null;
}

// Checked in JS before the database is asked, so a garbage header costs no
// round trip.
function isWellFormed(token) {
  return SECRET_RE.test(String(token));
}

// A key's name is display text a person chose, not an identifier: trim it,
// collapse whitespace, cap the length, and drop control characters. Whatever
// else a grown-up wants to call their key is their business.
function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Give the key a name.' };
  const name = raw.replace(CONTROL_CHARS, ' ').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the key a name.' };
  if (name.length > MAX_NAME_LEN) {
    return { ok: false, error: `Keep the name under ${MAX_NAME_LEN} characters.` };
  }
  return { ok: true, name };
}

module.exports = {
  TOKEN_PREFIX,
  SECRET_BYTES,
  PREFIX_CHARS,
  MAX_KEYS_PER_USER,
  MAX_NAME_LEN,
  generateToken,
  hashToken,
  displayPrefix,
  looksLikeApiKey,
  extractPresentedKey,
  isWellFormed,
  validateName,
};
