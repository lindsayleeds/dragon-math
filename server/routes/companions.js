const express = require('express');
const { and, eq, inArray, asc } = require('drizzle-orm');
const { db, schema } = require('../db');
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
const BOSS_NODE_IDS = Object.keys(BOSS_NODE_TO_COMPANION).map(Number);
const VALID_COMPANION_IDS = new Set(['pip', ...Object.values(BOSS_NODE_TO_COMPANION)]);

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
  await db
    .insert(schema.userCompanions)
    .values({ userId, companionId: 'pip' })
    .onConflictDoNothing();

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
    await db
      .insert(schema.userCompanions)
      .values({ userId, companionId: cid })
      .onConflictDoNothing();
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

  await db
    .insert(schema.userCompanions)
    .values({ userId, companionId: companion_id })
    .onConflictDoNothing();

  res.json({ owned: await readOwned(userId), active_companion_id: await readActive(userId) });
});

// PUT /api/companions/active { companion_id }
router.put('/active', async (req, res) => {
  const userId = req.user.id;
  const { companion_id } = req.body || {};
  if (!VALID_COMPANION_IDS.has(companion_id)) {
    return res.status(400).json({ error: 'Unknown companion_id' });
  }
  const owns = await db
    .select({ id: schema.userCompanions.id })
    .from(schema.userCompanions)
    .where(and(
      eq(schema.userCompanions.userId, userId),
      eq(schema.userCompanions.companionId, companion_id),
    ))
    .limit(1);
  if (owns.length === 0) return res.status(400).json({ error: 'You do not own that companion' });

  await db
    .update(schema.users)
    .set({ activeCompanionId: companion_id })
    .where(eq(schema.users.id, userId));

  res.json({ active_companion_id: companion_id });
});

module.exports = router;
