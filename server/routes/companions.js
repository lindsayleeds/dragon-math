const express = require('express');
const { and, eq, inArray, asc } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  BOSS_NODE_TO_COMPANION, BOSS_NODE_IDS, VALID_COMPANION_IDS, grantCompanion, ownsCompanion, setActiveCompanion,
} = require('../lib/companions');

const router = express.Router();
router.use(requireAuth);

async function readOwned(userId) {
  return db
    .select({
      companion_id: schema.userCompanions.companionId,
      acquired_at:  schema.userCompanions.acquiredAt,
    })
    .from(schema.userCompanions)
    .where(eq(schema.userCompanions.userId, userId))
    .orderBy(asc(schema.userCompanions.acquiredAt));
}

async function readActive(userId) {
  const [row] = await db
    .select({ active: schema.users.activeCompanionId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.active || 'pip';
}

// Ensure user has Pip (starter) and any companions implied by completed boss nodes.
// Idempotent — safe to call on every GET.
async function selfHeal(userId) {
  await grantCompanion(db, userId, 'pip');

  const completedBosses = await db
    .select({ node_id: schema.nodeProgress.nodeId })
    .from(schema.nodeProgress)
    .where(and(
      eq(schema.nodeProgress.userId, userId),
      eq(schema.nodeProgress.completed, true),
      inArray(schema.nodeProgress.nodeId, BOSS_NODE_IDS),
    ));

  for (const { node_id } of completedBosses) {
    const cid = BOSS_NODE_TO_COMPANION[node_id];
    if (!cid) continue;
    await grantCompanion(db, userId, cid);
  }
}

// GET /api/companions — owned list + active id (self-heals on every call)
router.get('/', async (req, res) => {
  const userId = req.user.id;
  await selfHeal(userId);
  res.json({
    owned: await readOwned(userId),
    active_companion_id: await readActive(userId),
  });
});

// POST /api/companions/capture { companion_id }
// Verifies the player has actually beaten the matching boss before inserting.
router.post('/capture', async (req, res) => {
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
  const beaten = await db
    .select({ id: schema.nodeProgress.id })
    .from(schema.nodeProgress)
    .where(and(
      eq(schema.nodeProgress.userId, userId),
      eq(schema.nodeProgress.nodeId, Number(bossNodeId)),
      eq(schema.nodeProgress.completed, true),
    ))
    .limit(1);
  if (beaten.length === 0) {
    return res.status(400).json({ error: 'You have not befriended this dragon yet' });
  }

  await grantCompanion(db, userId, companion_id);

  res.json({ owned: await readOwned(userId), active_companion_id: await readActive(userId) });
});

// PUT /api/companions/active { companion_id }
router.put('/active', async (req, res) => {
  const userId = req.user.id;
  const { companion_id } = req.body || {};
  if (!VALID_COMPANION_IDS.has(companion_id)) {
    return res.status(400).json({ error: 'Unknown companion_id' });
  }
  if (!(await ownsCompanion(db, userId, companion_id))) {
    return res.status(400).json({ error: 'You do not own that companion' });
  }

  await setActiveCompanion(db, userId, companion_id);

  res.json({ active_companion_id: companion_id });
});

module.exports = router;
