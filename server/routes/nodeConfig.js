const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/node-config — public list of per-node config (used by the battle
// screen to size the grid and pick difficulty). No auth: it's not user-specific.
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT node_id, grid_size, ops, range_min, range_max, ai_seconds, shape_id FROM node_config ORDER BY node_id'
  ).all();
  const configs = rows.map(r => ({
    node_id: r.node_id,
    grid_size: r.grid_size,
    ops: safeParseOps(r.ops),
    range_min: r.range_min,
    range_max: r.range_max,
    ai_seconds: r.ai_seconds,
    shape_id: r.shape_id,
  }));
  res.json({ configs });
});

function safeParseOps(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ['add'];
  } catch {
    return ['add'];
  }
}

module.exports = router;
