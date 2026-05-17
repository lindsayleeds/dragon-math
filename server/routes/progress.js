const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/progress
router.get('/', (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT current_node_id, username FROM users WHERE id = ?').get(userId);
  const progress = db.prepare(
    'SELECT node_id, completed, stars, completed_at FROM node_progress WHERE user_id = ?'
  ).all(userId);
  res.json({ current_node_id: user.current_node_id, username: user.username, progress });
});

// PUT /api/progress/:nodeId
router.put('/:nodeId', (req, res) => {
  const userId = req.user.id;
  const nodeId = parseInt(req.params.nodeId, 10);
  const { stars = 3 } = req.body;

  if (isNaN(nodeId) || nodeId < 1)
    return res.status(400).json({ error: 'Invalid nodeId' });

  db.prepare(`
    INSERT INTO node_progress (user_id, node_id, completed, stars, completed_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(user_id, node_id) DO UPDATE SET
      completed = 1, stars = excluded.stars, completed_at = excluded.completed_at
  `).run(userId, nodeId, stars, new Date().toISOString());

  const user = db.prepare('SELECT current_node_id FROM users WHERE id = ?').get(userId);
  if (nodeId >= user.current_node_id) {
    db.prepare('UPDATE users SET current_node_id = ? WHERE id = ?').run(nodeId + 1, userId);
  }

  res.json({ success: true });
});

module.exports = router;
