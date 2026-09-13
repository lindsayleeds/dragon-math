// Create, list and delete the API keys a grown-up uses to manage their own
// children's learning content from a script — see docs/API.md for the endpoints
// a key can then call, and server/middleware/apiKey.js for how a key is turned
// back into a user.
//
// THE WRITE ROUTES HERE TAKE A SESSION, NEVER A KEY. That is the point of the
// per-route middleware below rather than a `router.use`: if a key could mint
// another key, a leaked key would be impossible to contain — the attacker would
// simply issue a fresh one, and could delete the key whose revocation was about
// to lock them out. Signing in is the recovery path, so it must be the only way
// to reach these three.
//
// /whoami is the exception and is safe to expose to a key: it reports only what
// the key's holder can already read, and a script needs it because every write
// is addressed by `child_id`.

const express = require('express');
const { and, asc, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent } = require('../middleware/auth');
const { authenticateWithApiKey } = require('../middleware/apiKey');
const { rateLimit } = require('../lib/rateLimit');
const { MAX_KEYS_PER_USER, generateToken, validateName } = require('../lib/apiKeys');

const router = express.Router();

// The session-only gate for the three management routes.
const session = [requireAuth, requireParent];

function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    // Never the token: it is unrecoverable after creation by design.
    prefix: row.prefix,
    last_used_at: row.lastUsedAt,
    created_at: row.createdAt,
  };
}

async function keysForUser(userId) {
  const rows = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(asc(schema.apiKeys.createdAt), asc(schema.apiKeys.id));
  return rows.map(publicKey);
}

// GET /api/api-keys — the caller's own keys, secrets omitted.
router.get('/', session, async (req, res) => {
  res.json({ keys: await keysForUser(req.user.id), max: MAX_KEYS_PER_USER });
});

// POST /api/api-keys — { name }
// The ONLY time the plaintext token is ever returned. Everything after this
// holds a SHA-256 of it, so a key that is lost has to be replaced, not recovered.
router.post('/', session, async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = await rateLimit({ key: `apikey-create:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many keys created. Try again later.' });
  }

  const name = validateName((req.body || {}).name);
  if (!name.ok) return res.status(400).json({ error: name.error });

  const [{ count }] = await db
    .select({ count: sql`COUNT(*)::int`.as('count') })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, req.user.id));
  if (count >= MAX_KEYS_PER_USER) {
    return res.status(400).json({
      error: `That's ${MAX_KEYS_PER_USER} keys already — delete one to make another.`,
    });
  }

  const { token, prefix, tokenHash } = generateToken();
  const [created] = await db
    .insert(schema.apiKeys)
    .values({ userId: req.user.id, name: name.name, prefix, tokenHash })
    .returning({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
    });

  res.status(201).json({ key: publicKey(created), token });
});

// DELETE /api/api-keys/:keyId
// Deleting the row IS the revocation — the middleware finds keys by hash, so a
// missing row can never authenticate again. There is no soft-delete state to
// reason about, and nothing worth keeping once a key is retired.
router.delete('/:keyId', session, async (req, res) => {
  const keyId = Number(req.params.keyId);
  if (!Number.isInteger(keyId) || keyId <= 0) {
    return res.status(400).json({ error: 'Invalid key id' });
  }
  // Scoped by owner in the same statement, so one grown-up cannot delete
  // another's key by guessing an id — and an id that isn't theirs is a 404,
  // which does not confirm that it exists.
  const [deleted] = await db
    .delete(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.userId, req.user.id)))
    .returning({ id: schema.apiKeys.id });
  if (!deleted) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

// GET /api/api-keys/whoami — accepts a key OR a session.
//
// The starting point for a script: every spelling-list and passage write is
// addressed by `child_id`, and this is where those ids come from. It reports
// nothing the caller could not already read through the dashboard.
router.get('/whoami', authenticateWithApiKey, async (req, res) => {
  const children = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      real_name: schema.users.realName,
    })
    .from(schema.parentChildLinks)
    .innerJoin(schema.users, eq(schema.users.id, schema.parentChildLinks.childId))
    .where(eq(schema.parentChildLinks.parentId, req.user.id))
    .orderBy(asc(schema.users.username));

  res.json({
    // `key` is null for a browser session, which is how a caller can tell which
    // credential answered.
    key: req.apiKey ? { name: req.apiKey.name, prefix: req.apiKey.prefix } : null,
    user: { id: req.user.id, username: req.user.username },
    children,
  });
});

module.exports = router;
