const express = require('express');
const { loadNodeConfigs } = require('./nodeConfig');
const { buildRuleSettings } = require('../lib/ruleSettings');

const router = express.Router();

// GET /api/rule-settings — the versioned rule-settings document: per-node
// config plus the game-wide tunables (see server/lib/ruleSettings.js for the
// shape and the meaning of its two version fields). Public for the same reason
// /api/node-config is: nothing in it is user-specific, and a guest or an
// offline-first client needs it before anyone signs in.
router.get('/', async (req, res) => {
  const nodes = await loadNodeConfigs();
  res.json(buildRuleSettings(nodes));
});

module.exports = router;
