// Lets a request authenticate with a parent API key instead of a session.
//
// Read the auth-boundaries section of AGENTS.md first. This is NOT a third auth
// model: a key resolves to an ordinary user row and publishes the same `req.user`
// shape `requireAuth` publishes from a JWT, so every downstream ownership check
// — resolveChildAccess() in routes/spelling.js and routes/memoryPassages.js —
// runs unchanged and unaware of how the caller identified themselves. A key can
// therefore reach exactly the children its owner is linked to and nothing more.
//
// What bounds a key to spelling lists and memory passages is WHERE THIS IS
// MOUNTED, not a scope column on the key. Only those two routers call it;
// everything else still uses requireAuth directly, so a key is rejected there
// for the ordinary reason that `dmk_…` is not a valid JWT. Widening a key's
// reach means editing a router — a visible, reviewable change — which is the
// property to preserve. Notably /api/api-keys itself does NOT accept a key for
// its write routes: a leaked key must not be able to mint more keys or delete
// the one that would revoke it.

const { eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('./auth');
const { rateLimit } = require('../lib/rateLimit');
const { extractPresentedKey, hashToken, isWellFormed } = require('../lib/apiKeys');

// last_used_at exists so a person can spot a key they no longer recognise. It
// does not need to be exact, and writing it on every request would double the
// statement count of a bulk import for no benefit — so it is refreshed at most
// this often.
const LAST_USED_REFRESH_MS = 60 * 1000;

// Deliberately identical wording for "no such key", "malformed key" and "the
// owner is gone": which of those it is would tell an unauthenticated caller
// something about the key they presented.
const BAD_KEY = { error: 'Invalid API key' };

async function authenticateWithApiKey(req, res, next) {
  const presented = extractPresentedKey(req.headers);

  // Not an API-key request at all — hand it to the ordinary session path, which
  // is still what every browser request takes.
  if (!presented) return requireAuth(req, res, next);

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // A ceiling on how hard API keys can be driven from one source. Unlike the
  // /admin gate this is not really a brute-force defence — a key is 256 random
  // bits, so guessing is hopeless regardless — it is cost control, and a bound
  // on what a leaked key can do before someone notices. Set well above real
  // scripted use: importing a term of spelling lists is tens of requests.
  //
  // On one line with literal values on purpose, and awaited: that is the shape
  // server/lib/rateLimit.test.js parses, and it pins both numbers so a change
  // here cannot pass as a tidy-up. An unawaited call would read `allowed` off a
  // Promise and 429 everything.
  const limit = await rateLimit({ key: `apikey-auth:${ip}`, limit: 600, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many API requests. Try again in a few minutes.' });
  }

  // Checked in JS first so a garbage header costs no round trip.
  if (!isWellFormed(presented)) return res.status(401).json(BAD_KEY);

  const [row] = await db
    .select({
      keyId: schema.apiKeys.id,
      keyName: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      userId: schema.users.id,
      username: schema.users.username,
      accountType: schema.users.accountType,
      adultRole: schema.users.adultRole,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
    .where(eq(schema.apiKeys.tokenHash, hashToken(presented)))
    .limit(1);

  if (!row) return res.status(401).json(BAD_KEY);

  // Keys are only ever issued to grown-ups (see routes/apiKeys.js). Re-checking
  // the live row rather than trusting issue time means an account that changed
  // type stops working immediately, the same way school-admin status is always
  // read fresh rather than carried in a JWT.
  if (row.accountType !== 'parent') {
    return res.status(403).json({ error: 'API keys are only valid for grown-up accounts.' });
  }

  req.user = {
    id: row.userId,
    username: row.username,
    account_type: row.accountType,
    adult_role: row.adultRole || 'parent',
  };
  // Lets a handler tell a scripted call from a dashboard one — used by
  // /api/api-keys/whoami, and available to anything that later needs it.
  req.apiKey = { id: row.keyId, name: row.keyName, prefix: row.prefix };

  const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  if (Date.now() - last > LAST_USED_REFRESH_MS) {
    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, row.keyId));
  }

  next();
}

module.exports = { authenticateWithApiKey, LAST_USED_REFRESH_MS };
