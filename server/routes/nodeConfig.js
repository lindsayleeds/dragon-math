const express = require('express');
const { db, schema } = require('../db');

const router = express.Router();

// GET /api/node-config — public list of per-node config (used by the battle
// screen to size the grid and pick difficulty). No auth: it's not user-specific.
router.get('/', async (req, res) => {
  const rows = await db
    .select({
      node_id: schema.nodeConfig.nodeId,
      grid_size: schema.nodeConfig.gridSize,
      ops: schema.nodeConfig.ops,
      range_min: schema.nodeConfig.rangeMin,
      range_max: schema.nodeConfig.rangeMax,
      ai_seconds: schema.nodeConfig.aiSeconds,
      shape_id: schema.nodeConfig.shapeId,
    })
    .from(schema.nodeConfig)
    .orderBy(schema.nodeConfig.nodeId);

  const configs = rows.map(r => ({ ...r, ops: safeParseOps(r.ops) }));
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
