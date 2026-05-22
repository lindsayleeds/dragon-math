const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/dragon-trial/complete — finalize a one-time placement test.
// Body: { target_node_id, results: { add: {correct,total}, sub: {...}, mul: {...}, div: {...} } }
// - Sets dragon_trial_completed = 1 (idempotent: refuses if already 1).
// - Promotes the player to target_node_id, marking nodes 1..(target-1) complete.
//   This mirrors the admin promote route so the map renders the path-so-far filled in.
router.post('/complete', (req, res) => {
  const userId = req.user.id;
  const user = db.prepare(
    "SELECT id, account_type, dragon_trial_completed, current_node_id FROM users WHERE id = ?"
  ).get(userId);
  if (!user || user.account_type !== 'child') {
    return res.status(403).json({ error: 'Only child accounts can take the Dragon\'s Trial.' });
  }
  if (user.dragon_trial_completed) {
    return res.status(409).json({ error: 'Dragon\'s Trial has already been taken.' });
  }

  const targetNodeId = parseInt(req.body?.target_node_id, 10);
  if (!Number.isInteger(targetNodeId) || targetNodeId < 1) {
    return res.status(400).json({ error: 'target_node_id must be a positive integer' });
  }
  const exists = db.prepare('SELECT node_id FROM node_config WHERE node_id = ?').get(targetNodeId);
  if (!exists) return res.status(400).json({ error: `Unknown target_node_id ${targetNodeId}` });

  const upsert = db.prepare(`
    INSERT INTO node_progress (user_id, node_id, completed, stars, completed_at)
    VALUES (?, ?, 1, 3, ?)
    ON CONFLICT(user_id, node_id) DO UPDATE SET
      completed = 1,
      stars = MAX(IFNULL(node_progress.stars, 0), excluded.stars),
      completed_at = COALESCE(node_progress.completed_at, excluded.completed_at)
  `);
  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET current_node_id = ?, dragon_trial_completed = 1 WHERE id = ?')
      .run(targetNodeId, userId);
    const now = new Date().toISOString();
    for (let n = 1; n < targetNodeId; n++) upsert.run(userId, n, now);
  });
  apply();

  const updated = db.prepare(
    'SELECT id, username, account_type, current_node_id, avatar, dragon_trial_completed FROM users WHERE id = ?'
  ).get(userId);
  res.json({
    ok: true,
    user: {
      id: updated.id,
      username: updated.username,
      account_type: updated.account_type || 'child',
      current_node_id: updated.current_node_id,
      avatar: updated.avatar || '⚔️',
      dragon_trial_completed: !!updated.dragon_trial_completed,
    },
  });
});

module.exports = router;
