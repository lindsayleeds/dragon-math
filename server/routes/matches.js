const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_OUTCOMES = new Set(['child', 'ai', 'incomplete']);

// POST /api/matches — open a new match row for this user/node. Returns the
// match id, which the client passes back to /end when the battle resolves.
router.post('/', (req, res) => {
  const userId = req.user.id;
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id is required' });
  }
  const result = db.prepare(
    'INSERT INTO matches (user_id, node_id) VALUES (?, ?)'
  ).run(userId, nodeId);
  res.status(201).json({ id: result.lastInsertRowid });
});

// POST /api/matches/:id/end — finalize an open match with an outcome and the
// final scores. Idempotent: if the row is already finalized (ended_at set) we
// leave it alone so a late "incomplete" beacon can't clobber a real win/loss.
router.post('/:id/end', (req, res) => {
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

  const row = db.prepare(
    'SELECT id, user_id, ended_at FROM matches WHERE id = ?'
  ).get(id);
  if (!row) return res.status(404).json({ error: 'Match not found' });
  if (row.user_id !== userId) return res.status(403).json({ error: 'Not your match' });
  if (row.ended_at) {
    return res.json({ ok: true, alreadyEnded: true });
  }

  db.prepare(`
    UPDATE matches
    SET ended_at = datetime('now'), outcome = ?, player_score = ?, ai_score = ?
    WHERE id = ?
  `).run(outcome, playerScore, aiScore, id);

  res.json({ ok: true });
});

module.exports = router;
