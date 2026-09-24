// POST /api/sync/events — the iOS app's offline event upload (ADR 0003) — and
// GET /api/sync/progress, what the device pulls back afterwards.
//
// This file is only the HTTP edge: auth, the rate limit, and the batch
// envelope. What each event does, how duplicates and failures are handled, and
// why it is one transaction per event live in server/lib/syncEvents.js; the
// wire contract is server/contracts/sync.js.
//
// Session-only (requireAuth), deliberately: a parent API key is not accepted,
// because what bounds a key is where authenticateWithApiKey is mounted (see the
// auth boundaries in CLAUDE.md) and a scripted client has no business writing a
// kid's play history. A kid session writes its own events; a parent session may
// write a linked child's — which is how a guest's queue reaches the new child
// profile after sign-up. Both are decided per event by resolveChildAccess.
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { parseInput } = require('../lib/parseInput');
const { resolveChildAccess } = require('../lib/childAccess');
const { applySyncBatch } = require('../lib/syncEvents');
const { childProgress } = require('../lib/syncProgress');
const { SyncBatchEnvelope } = require('../contracts/sync');
const { ChildIdQuery } = require('../contracts/spelling');

const router = express.Router();
router.use(requireAuth);

router.post('/events', async (req, res) => {
  // Generous: a device back from a week offline uploads its queue in batches
  // of up to 100 back to back. This caps a runaway retry loop, not real use.
  const limit = await rateLimit({ key: `sync-events:${req.user.id}`, limit: 240, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many uploads. Try again in a few minutes.' });

  const envelope = parseInput(SyncBatchEnvelope, req.body);
  if (!envelope.ok) return res.status(400).json({ error: envelope.error });

  const results = await applySyncBatch({
    exec: db,
    user: req.user,
    events: envelope.data.events,
    resolveChild: resolveChildAccess,
  });
  res.json({ results });
});

// GET /api/sync/progress?child_id= — the read half: what the server has for a
// child from every device, pulled after an upload (server/lib/syncProgress.js).
// Same callers as the upload: a kid for themselves, a parent for a linked child.
router.get('/progress', async (req, res) => {
  const query = parseInput(ChildIdQuery, req.query);
  if (!query.ok) return res.status(400).json({ error: query.error });
  const childId = await resolveChildAccess(req.user, query.data.child_id ?? null);
  if (!childId) return res.status(403).json({ error: 'Not your child' });
  res.json({ child_id: childId, ...(await childProgress(db, childId)) });
});

module.exports = router;
