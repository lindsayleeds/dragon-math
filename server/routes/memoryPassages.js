const express = require('express');
const { and, asc, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  MAX_PASSAGES_PER_CHILD,
  validatePassage,
} = require('../lib/memoryPassages');

const router = express.Router();
router.use(requireAuth);

const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3 };

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// Mirrors custom spelling-list access: a child reads their own passages and a
// grown-up may manage only a child linked to their account.
async function resolveChildAccess(user, requestedChildId) {
  if (user.account_type === 'child') {
    return requestedChildId && requestedChildId !== user.id ? null : user.id;
  }
  if (!requestedChildId) return null;
  const [link] = await db.select({ parentId: schema.parentChildLinks.parentId })
    .from(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, user.id),
      eq(schema.parentChildLinks.childId, requestedChildId),
    )).limit(1);
  return link ? requestedChildId : null;
}

async function loadAccessiblePassage(user, passageId) {
  const [passage] = await db.select().from(schema.memoryPassages)
    .where(eq(schema.memoryPassages.id, passageId)).limit(1);
  if (!passage) return null;
  const childId = await resolveChildAccess(user, passage.childId);
  return childId === passage.childId ? passage : null;
}

function publicPassage(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    mastery_level: row.masteryLevel,
    last_practiced_at: row.lastPracticedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// GET /api/memory-passages[?child_id=N]
router.get('/', async (req, res) => {
  const requested = req.query.child_id ? positiveInt(req.query.child_id) : null;
  const childId = await resolveChildAccess(req.user, requested);
  if (!childId) return res.status(403).json({ error: 'Not your child' });
  const rows = await db.select().from(schema.memoryPassages)
    .where(eq(schema.memoryPassages.childId, childId))
    .orderBy(asc(schema.memoryPassages.createdAt), asc(schema.memoryPassages.id));
  res.json({ passages: rows.map(publicPassage) });
});

// POST /api/memory-passages — grown-up assigns one passage to one linked child.
router.post('/', async (req, res) => {
  if (req.user.account_type !== 'parent') {
    return res.status(403).json({ error: 'Grown-up account required' });
  }
  const childId = await resolveChildAccess(req.user, positiveInt(req.body?.child_id));
  if (!childId) return res.status(403).json({ error: 'Not your child' });
  const parsed = validatePassage(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${schema.users} WHERE ${schema.users.id} = ${childId} FOR UPDATE`);
    const [{ count }] = await tx.select({ count: sql`COUNT(*)::int`.as('count') })
      .from(schema.memoryPassages)
      .where(eq(schema.memoryPassages.childId, childId));
    if (count >= MAX_PASSAGES_PER_CHILD) return { limitReached: true };

    const [passage] = await tx.insert(schema.memoryPassages).values({
      childId,
      createdById: req.user.id,
      title: parsed.passage.title,
      category: parsed.passage.category,
      body: parsed.passage.body,
    }).returning();
    return { passage };
  });
  if (result.limitReached) {
    return res.status(400).json({ error: `That's ${MAX_PASSAGES_PER_CHILD} passages already—delete one to add another.` });
  }
  res.status(201).json({ passage: publicPassage(result.passage) });
});

router.patch('/:passageId', async (req, res) => {
  if (req.user.account_type !== 'parent') {
    return res.status(403).json({ error: 'Grown-up account required' });
  }
  const passageId = positiveInt(req.params.passageId);
  if (!passageId) return res.status(400).json({ error: 'Invalid passage id' });
  const existing = await loadAccessiblePassage(req.user, passageId);
  if (!existing) return res.status(404).json({ error: 'Passage not found' });
  const parsed = validatePassage(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const clientRevision = typeof req.body?.updated_at === 'string'
    ? new Date(req.body.updated_at)
    : null;
  if (!clientRevision || Number.isNaN(clientRevision.getTime())) {
    return res.status(400).json({ error: 'Valid passage revision required' });
  }
  if (new Date(existing.updatedAt).getTime() !== clientRevision.getTime()) {
    return res.status(409).json({
      error: 'This passage changed while it was being edited.',
      code: 'passage_changed',
    });
  }

  const wordingChanged = existing.body !== parsed.passage.body;
  const [updated] = await db.update(schema.memoryPassages).set({
    title: parsed.passage.title,
    category: parsed.passage.category,
    body: parsed.passage.body,
    updatedAt: new Date(),
    ...(wordingChanged ? { masteryLevel: 0, lastPracticedAt: null } : {}),
  }).where(and(
    eq(schema.memoryPassages.id, passageId),
    eq(schema.memoryPassages.childId, existing.childId),
    eq(schema.memoryPassages.updatedAt, clientRevision),
  )).returning();
  if (!updated) {
    return res.status(409).json({
      error: 'This passage changed while it was being edited.',
      code: 'passage_changed',
    });
  }
  res.json({ passage: publicPassage(updated) });
});

router.delete('/:passageId', async (req, res) => {
  if (req.user.account_type !== 'parent') {
    return res.status(403).json({ error: 'Grown-up account required' });
  }
  const passageId = positiveInt(req.params.passageId);
  if (!passageId) return res.status(400).json({ error: 'Invalid passage id' });
  const existing = await loadAccessiblePassage(req.user, passageId);
  if (!existing) return res.status(404).json({ error: 'Passage not found' });
  await db.delete(schema.memoryPassages).where(eq(schema.memoryPassages.id, passageId));
  res.json({ success: true });
});

router.post('/:passageId/progress', async (req, res) => {
  if (req.user.account_type !== 'child') {
    return res.status(403).json({ error: 'Child account required' });
  }
  const passageId = positiveInt(req.params.passageId);
  const level = DIFFICULTY_LEVEL[req.body?.difficulty];
  const practicedBody = req.body?.body;
  const practicedRevision = typeof req.body?.updated_at === 'string'
    ? new Date(req.body.updated_at)
    : null;
  if (!passageId || !level || typeof practicedBody !== 'string'
    || !practicedRevision || Number.isNaN(practicedRevision.getTime())) {
    return res.status(400).json({ error: 'Valid passage, difficulty, wording, and revision required' });
  }
  const existing = await loadAccessiblePassage(req.user, passageId);
  if (!existing) return res.status(404).json({ error: 'Passage not found' });
  if (existing.body !== practicedBody
    || new Date(existing.updatedAt).getTime() !== practicedRevision.getTime()) {
    return res.status(409).json({
      error: 'This passage changed while it was being practiced.',
      code: 'passage_changed',
    });
  }
  const updated = await db.update(schema.memoryPassages).set({
    masteryLevel: sql`GREATEST(${schema.memoryPassages.masteryLevel}, ${level})`,
    lastPracticedAt: new Date(),
  }).where(and(
    eq(schema.memoryPassages.id, passageId),
    eq(schema.memoryPassages.childId, req.user.id),
    eq(schema.memoryPassages.body, practicedBody),
    eq(schema.memoryPassages.updatedAt, practicedRevision),
  )).returning();
  if (updated.length === 0) {
    return res.status(409).json({
      error: 'This passage changed while it was being practiced.',
      code: 'passage_changed',
    });
  }
  res.json({ passage: publicPassage(updated[0]) });
});

module.exports = router;
