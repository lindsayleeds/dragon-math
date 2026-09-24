const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { MATCH_OUTCOMES, createMatch, finalizeMatch } = require('../lib/playRecords');

const router = express.Router();
router.use(requireAuth);

// POST /api/matches — open a new match row for this user/node. Returns the
// match id, which the client passes back to /end when the battle resolves.
// (The iOS app records matches through the sync upload instead, keyed by an id
// it mints offline — see recordMatchStart in server/lib/playRecords.js.)
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id is required' });
  }
  const id = await createMatch(db, { userId, nodeId });
  res.status(201).json({ id });
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
  if (!MATCH_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: `outcome must be one of ${[...MATCH_OUTCOMES].join(', ')}` });
  }
  const playerScore = Number.isInteger(req.body?.player_score) ? req.body.player_score : 0;
  const aiScore     = Number.isInteger(req.body?.ai_score)     ? req.body.ai_score     : 0;

  const result = await finalizeMatch(db, { id, userId, outcome, playerScore, aiScore });
  if (result === 'not_found') return res.status(404).json({ error: 'Match not found' });
  if (result === 'forbidden') return res.status(403).json({ error: 'Not your match' });
  if (result === 'already_ended') return res.json({ ok: true, alreadyEnded: true });
  res.json({ ok: true });
});

module.exports = router;
