const express = require('express');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/progress
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const [user] = await db
    .select({
      current_node_id: schema.users.currentNodeId,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const progress = await db
    .select({
      node_id: schema.nodeProgress.nodeId,
      completed: schema.nodeProgress.completed,
      stars: schema.nodeProgress.stars,
      completed_at: schema.nodeProgress.completedAt,
    })
    .from(schema.nodeProgress)
    .where(eq(schema.nodeProgress.userId, userId));

  res.json({ current_node_id: user.current_node_id, username: user.username, progress });
});

// PUT /api/progress/:nodeId
router.put('/:nodeId', async (req, res) => {
  const userId = req.user.id;
  const nodeId = parseInt(req.params.nodeId, 10);
  const { stars = 3 } = req.body;

  if (isNaN(nodeId) || nodeId < 1)
    return res.status(400).json({ error: 'Invalid nodeId' });

  const completedAt = new Date();

  await db
    .insert(schema.nodeProgress)
    .values({ userId, nodeId, completed: true, stars, completedAt })
    .onConflictDoUpdate({
      target: [schema.nodeProgress.userId, schema.nodeProgress.nodeId],
      set: {
        completed: true,
        stars: sql`excluded.stars`,
        completedAt: sql`excluded.completed_at`,
      },
    });

  const [user] = await db
    .select({ current_node_id: schema.users.currentNodeId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (nodeId >= user.current_node_id) {
    await db
      .update(schema.users)
      .set({ currentNodeId: nodeId + 1 })
      .where(eq(schema.users.id, userId));
  }

  res.json({ success: true });
});

module.exports = router;
