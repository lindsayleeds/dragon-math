// GET /api/content/versions — a version hash per content document the iOS app
// caches (server/contracts/content.js), so a device downloads only what changed
// since its last sync and plays from its copies offline (ADR 0003).
//
// Each hash is taken over exactly the body that document's own route sends
// (contentVersion in ../lib/ruleSettings), built by the same loader, so the two
// can't drift: rule_settings is that document's own `version`.
//
// Public like /api/rule-settings; a session is optional and only adds one
// child's versions. A header that is there but invalid still 401s, so a
// signed-in device notices its session has gone rather than silently getting
// less. Only JWT sessions — API keys stay bounded to the routers that mount
// authenticateWithApiKey (see CLAUDE.md).
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveChildAccess } = require('../lib/childAccess');
const { parseInput } = require('../lib/parseInput');
const playRecords = require('../lib/playRecords');
const { withArt } = require('../lib/dragonArt');
const { buildRuleSettings, contentVersion } = require('../lib/ruleSettings');
const { loadNodeConfigs } = require('./nodeConfig');
const { listsForChild } = require('./spelling');
const { passagesForChild } = require('./memoryPassages');
const { ContentVersionsQuery } = require('../contracts/content');

const router = express.Router();

function optionalSession(req, res, next) {
  if (!req.headers.authorization) return next();
  return requireAuth(req, res, next);
}

router.get('/versions', optionalSession, async (req, res) => {
  const query = parseInput(ContentVersionsQuery, req.query);
  if (!query.ok) return res.status(400).json({ error: query.error });
  const requested = query.data.child_id ?? null;
  if (requested && !req.user) {
    return res.status(401).json({ error: "Sign in to check a child's content" });
  }

  // A child session always gets its own; a grown-up only when they name one.
  let childId = null;
  if (req.user && (requested || req.user.account_type === 'child')) {
    childId = await resolveChildAccess(req.user, requested);
    if (!childId) return res.status(403).json({ error: 'Not your child' });
  }

  const nodes = await loadNodeConfigs();
  // With the art hashes, as GET /api/dragons/catalog sends it: replaced art is
  // a changed catalog.
  const catalog = withArt(await playRecords.activeCatalog(db));
  const versions = {
    rule_settings: buildRuleSettings(nodes).version,
    node_config: contentVersion({ configs: nodes }),
    dragon_catalog: contentVersion({ dragons: catalog, total: catalog.length }),
  };
  if (childId) {
    versions.child = {
      child_id: childId,
      spelling_lists: contentVersion({ lists: await listsForChild(childId, req.user.id) }),
      memory_passages: contentVersion({ passages: await passagesForChild(childId) }),
    };
  }
  res.json(versions);
});

module.exports = router;
