const express = require('express');
const { db, schema } = require('../db');

const router = express.Router();

// Every node_config row, ops parsed, in node_id order. Shared by
// GET /api/node-config and the `nodes` section of GET /api/rule-settings.
async function loadNodeConfigs() {
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

  return rows.map(r => ({ ...r, ops: safeParseOps(r.ops) }));
}

// GET /api/node-config — public list of per-node config (used by the admin
// difficulty editor). No auth: it's not user-specific. The battle screen reads
// the same rows through GET /api/rule-settings.
router.get('/', async (req, res) => {
  const configs = await loadNodeConfigs();
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
module.exports.loadNodeConfigs = loadNodeConfigs;
