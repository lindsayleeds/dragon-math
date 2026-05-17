const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Boss node → companion id. Mirrors NODE_TO_COMPANION in src/data/companions.js.
// Source of truth for capture validation and self-healing backfill.
const BOSS_NODE_TO_COMPANION = {
  8:  'forest_dragon',
  16: 'sunfire_dragon',
  25: 'crystal_dragon',
  33: 'sakura_dragon',
  41: 'storm_dragon',
};
const VALID_COMPANION_IDS = new Set(['pip', ...Object.values(BOSS_NODE_TO_COMPANION)]);

function readOwned(userId) {
  return db.prepare(
    'SELECT companion_id, acquired_at FROM user_companions WHERE user_id = ? ORDER BY acquired_at ASC'
  ).all(userId);
}

function readActive(userId) {
  const row = db.prepare('SELECT active_companion_id FROM users WHERE id = ?').get(userId);
  return row?.active_companion_id || 'pip';
}

// Ensure user has Pip (starter) and any companions implied by completed boss nodes.
// Idempotent — safe to call on every GET.
function selfHeal(userId) {
  const insert = db.prepare('INSERT OR IGNORE INTO user_companions (user_id, companion_id) VALUES (?, ?)');
  insert.run(userId, 'pip');

  const completedBosses = db.prepare(
    `SELECT node_id FROM node_progress
     WHERE user_id = ? AND completed = 1 AND node_id IN (${Object.keys(BOSS_NODE_TO_COMPANION).join(',')})`
  ).all(userId);
  for (const { node_id } of completedBosses) {
    const cid = BOSS_NODE_TO_COMPANION[node_id];
    if (cid) insert.run(userId, cid);
  }
}

// GET /api/companions — owned list + active id (self-heals on every call)
router.get('/', (req, res) => {
  const userId = req.user.id;
  selfHeal(userId);
  res.json({
    owned: readOwned(userId),
    active_companion_id: readActive(userId),
  });
});

// POST /api/companions/capture { companion_id }
// Verifies the player has actually beaten the matching boss before inserting.
router.post('/capture', (req, res) => {
  const userId = req.user.id;
  const { companion_id } = req.body || {};
  if (!VALID_COMPANION_IDS.has(companion_id)) {
    return res.status(400).json({ error: 'Unknown companion_id' });
  }
  if (companion_id === 'pip') {
    return res.status(400).json({ error: 'Pip is granted automatically' });
  }
  const bossNodeId = Object.entries(BOSS_NODE_TO_COMPANION)
    .find(([, cid]) => cid === companion_id)?.[0];
  const beaten = db.prepare(
    'SELECT 1 FROM node_progress WHERE user_id = ? AND node_id = ? AND completed = 1'
  ).get(userId, Number(bossNodeId));
  if (!beaten) {
    return res.status(400).json({ error: 'You have not befriended this dragon yet' });
  }
  db.prepare('INSERT OR IGNORE INTO user_companions (user_id, companion_id) VALUES (?, ?)')
    .run(userId, companion_id);
  res.json({ owned: readOwned(userId), active_companion_id: readActive(userId) });
});

// PUT /api/companions/active { companion_id }
router.put('/active', (req, res) => {
  const userId = req.user.id;
  const { companion_id } = req.body || {};
  if (!VALID_COMPANION_IDS.has(companion_id)) {
    return res.status(400).json({ error: 'Unknown companion_id' });
  }
  const owns = db.prepare(
    'SELECT 1 FROM user_companions WHERE user_id = ? AND companion_id = ?'
  ).get(userId, companion_id);
  if (!owns) return res.status(400).json({ error: 'You do not own that companion' });

  db.prepare('UPDATE users SET active_companion_id = ? WHERE id = ?').run(companion_id, userId);
  res.json({ active_companion_id: companion_id });
});

module.exports = router;
