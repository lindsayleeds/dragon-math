const express = require('express');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_OUTCOMES = new Set(['child', 'ai', 'incomplete']);

// POST /api/matches — open a new match row for this user/node. Returns the
// match id, which the client passes back to /end when the battle resolves.
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id is required' });
  }
  const [row] = await db
    .insert(schema.matches)
    .values({ userId, nodeId })
    .returning({ id: schema.matches.id });
  res.status(201).json({ id: row.id });
});

// POST /api/matches/:id/end — finalize an open match with an outcome and the
// final scores. Idempotent: if the row is already finalized (ended_at set) we
// leave it alone so a late "incomplete" beacon can't clobber a real win/loss.
router.post('/:id/end', async (req, res) => {
  const userId = req.user.id;
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid match id' });
  }
  const outcome = req.body?.outcome;
  if (!VALID_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: `outcome must be one of ${[...VALID_OUTCOMES].join(', ')}` });
  }
  const playerScore = Number.isInteger(req.body?.player_score) ? req.body.player_score : 0;
  const aiScore     = Number.isInteger(req.body?.ai_score)     ? req.body.ai_score     : 0;

  const [row] = await db
    .select({
      id: schema.matches.id,
      userId: schema.matches.userId,
      endedAt: schema.matches.endedAt,
    })
    .from(schema.matches)
    .where(eq(schema.matches.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: 'Match not found' });
  if (row.userId !== userId) return res.status(403).json({ error: 'Not your match' });
  if (row.endedAt) return res.json({ ok: true, alreadyEnded: true });

  await db
    .update(schema.matches)
    .set({ endedAt: sql`now()`, outcome, playerScore, aiScore })
    .where(eq(schema.matches.id, id));

  res.json({ ok: true });
});

module.exports = router;
