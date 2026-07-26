const express = require('express');
const { and, eq, inArray, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { randomCode } = require('../lib/joinCode');

const router = express.Router();
router.use(requireAuth);

// Tribes are a kids-only feature — the kid-owned mirror of classrooms. Every
// endpoint rejects adult (parent/teacher) accounts.
function kidOnly(req, res, next) {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only adventurers can join a tribe' });
  }
  next();
}
router.use(kidOnly);

// Insert a tribe with a freshly minted code AND enroll the owner as a member,
// retrying on a (rare) join-code collision so it never surfaces to the caller.
async function createTribeWithCode(ownerId, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      return await db.transaction(async (tx) => {
        const [tribe] = await tx
          .insert(schema.tribes)
          .values({ ownerId, name, joinCode })
          .returning({
            id: schema.tribes.id,
            name: schema.tribes.name,
            join_code: schema.tribes.joinCode,
            created_at: schema.tribes.createdAt,
          });
        await tx
          .insert(schema.tribeMembers)
          .values({ tribeId: tribe.id, childId: ownerId })
          .onConflictDoNothing();
        return tribe;
      });
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue; // join_code collision — retry
      throw err;
    }
  }
}

// Roster of one tribe, ranked by dragons collected (desc), ties broken by who
// got their most-recent dragon first. Mirrors classroomRoster so a kid's rank is
// consistent across /me and the tribemate view.
async function tribeRoster(tribeId) {
  const rows = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.needs_handle,
           COUNT(ud.dragon_id)::int AS dragons_collected,
           MIN(ud.first_acquired_at) AS first_dragon_at,
           (RANK() OVER (
             ORDER BY COUNT(ud.dragon_id) DESC, MIN(ud.first_acquired_at) ASC NULLS LAST
           ))::int AS rank
    FROM tribe_members tm
    JOIN users u ON u.id = tm.child_id
    LEFT JOIN user_dragons ud ON ud.user_id = u.id
    WHERE tm.tribe_id = ${tribeId}
    GROUP BY u.id, u.username, u.avatar, u.current_node_id, u.needs_handle
    ORDER BY rank, u.username
  `);
  return rows.rows;
}

// POST /api/tribes — { name } → create a tribe owned by the signed-in kid. The
// owner is enrolled as a member automatically.
router.post('/', async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = await rateLimit({ key: `tribe-create:${req.user.id}:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many new tribes. Try again later.' });

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 40) {
    return res.status(400).json({ error: 'Tribe name must be 1–40 characters.' });
  }
  const tribe = await createTribeWithCode(req.user.id, name);
  res.status(201).json({
    tribe: { ...tribe, is_owner: true, members: await tribeRoster(tribe.id) },
  });
});

// GET /api/tribes/me — the kid's tribe(s) with the ranked roster of each. The
// kid's own row is included so the UI can highlight "you".
router.get('/me', async (req, res) => {
  const memberships = await db
    .select({ tribeId: schema.tribeMembers.tribeId })
    .from(schema.tribeMembers)
    .where(eq(schema.tribeMembers.childId, req.user.id));

  if (memberships.length === 0) return res.json({ tribes: [] });

  const ids = memberships.map(m => m.tribeId);
  const tribeRows = await db
    .select({
      id: schema.tribes.id,
      name: schema.tribes.name,
      join_code: schema.tribes.joinCode,
      owner_id: schema.tribes.ownerId,
    })
    .from(schema.tribes)
    .where(inArray(schema.tribes.id, ids));

  const tribes = await Promise.all(
    tribeRows.map(async (t) => ({
      id: t.id,
      name: t.name,
      join_code: t.join_code,
      is_owner: t.owner_id === req.user.id,
      members: await tribeRoster(t.id),
    })),
  );
  res.json({ tribes });
});

// POST /api/tribes/join — { code } → enroll the signed-in kid in the tribe.
router.post('/join', async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = await rateLimit({ key: `tribe-join:${req.user.id}:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const GENERIC = { error: "We couldn't find a tribe with that code." };
  if (!code) return res.status(400).json(GENERIC);

  const [tribe] = await db
    .select({ id: schema.tribes.id, name: schema.tribes.name })
    .from(schema.tribes)
    .where(eq(schema.tribes.joinCode, code))
    .limit(1);
  if (!tribe) return res.status(404).json(GENERIC);

  await db
    .insert(schema.tribeMembers)
    .values({ tribeId: tribe.id, childId: req.user.id })
    .onConflictDoNothing();

  res.json({ tribe });
});

// GET /api/tribes/tribemate/:childId — a tribemate's public profile + their
// collected dragons + tribe rank. Viewable only if the viewer shares a tribe
// with the target. Unlike the classmate view, this returns ONLY collected
// dragons (no total_dragons) so the UI renders no locked gallery slots.
router.get('/tribemate/:childId', async (req, res) => {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid adventurer id' });
  }

  // Shared-tribe check: at least one tribe holds both the viewer and the target.
  const shared = await db.execute(sql`
    SELECT tm_t.tribe_id
    FROM tribe_members tm_v
    JOIN tribe_members tm_t ON tm_t.tribe_id = tm_v.tribe_id
    WHERE tm_v.child_id = ${req.user.id} AND tm_t.child_id = ${childId}
    LIMIT 1
  `);
  if (shared.rows.length === 0) {
    return res.status(403).json({ error: 'Not in your tribe' });
  }
  const tribeId = shared.rows[0].tribe_id;

  const [profile] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      current_node_id: schema.users.currentNodeId,
      needs_handle: schema.users.needsHandle,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, childId), eq(schema.users.accountType, 'child')))
    .limit(1);
  if (!profile) return res.status(404).json({ error: 'Adventurer not found' });

  const dragons = await db.execute(sql`
    SELECT ud.dragon_id, ud.count, ud.first_acquired_at,
           dc.name AS name,
           COALESCE(dc.rarity, 'common') AS rarity
    FROM user_dragons ud
    LEFT JOIN dragon_catalog dc ON dc.dragon_id = ud.dragon_id
    WHERE ud.user_id = ${childId}
    ORDER BY ud.dragon_id
  `);

  const roster = await tribeRoster(tribeId);
  const rankRow = roster.find(r => r.id === childId);

  res.json({
    tribemate: {
      ...profile,
      needs_handle: !!profile.needs_handle,
      rank: rankRow?.rank ?? null,
      tribe_size: roster.length,
      dragons_collected: rankRow?.dragons_collected ?? dragons.rows.length,
    },
    owned: dragons.rows,
  });
});

// Resolve and validate :tribeId from the path. Used by the action routes below.
function parseTribeId(req, res) {
  const tribeId = Number(req.params.tribeId);
  if (!Number.isInteger(tribeId) || tribeId <= 0) {
    res.status(400).json({ error: 'Invalid tribe id' });
    return null;
  }
  return tribeId;
}

// Verify the signed-in kid owns this tribe. Returns true on success, otherwise
// sends a 404 (don't leak existence) and returns false.
async function ownsTribe(tribeId, userId, res) {
  const [owned] = await db
    .select({ id: schema.tribes.id })
    .from(schema.tribes)
    .where(and(eq(schema.tribes.id, tribeId), eq(schema.tribes.ownerId, userId)))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: 'Tribe not found' });
    return false;
  }
  return true;
}

// POST /api/tribes/:tribeId/leave — the signed-in kid leaves the tribe. The
// owner can't leave their own tribe; they must delete it instead.
router.post('/:tribeId/leave', async (req, res) => {
  const tribeId = parseTribeId(req, res);
  if (tribeId === null) return;

  const [tribe] = await db
    .select({ ownerId: schema.tribes.ownerId })
    .from(schema.tribes)
    .where(eq(schema.tribes.id, tribeId))
    .limit(1);
  if (!tribe) return res.status(404).json({ error: 'Tribe not found' });
  if (tribe.ownerId === req.user.id) {
    return res.status(400).json({ error: 'You lead this tribe — delete it to disband it.' });
  }

  await db
    .delete(schema.tribeMembers)
    .where(and(
      eq(schema.tribeMembers.tribeId, tribeId),
      eq(schema.tribeMembers.childId, req.user.id),
    ));
  res.json({ ok: true });
});

// POST /api/tribes/:tribeId/rotate-code — owner mints a fresh join code.
router.post('/:tribeId/rotate-code', async (req, res) => {
  const tribeId = parseTribeId(req, res);
  if (tribeId === null) return;
  if (!await ownsTribe(tribeId, req.user.id, res)) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      await db.update(schema.tribes).set({ joinCode }).where(eq(schema.tribes.id, tribeId));
      return res.json({ join_code: joinCode });
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
});

// DELETE /api/tribes/:tribeId — owner disbands the tribe (cascades the roster
// rows; the kid accounts themselves are untouched).
router.delete('/:tribeId', async (req, res) => {
  const tribeId = parseTribeId(req, res);
  if (tribeId === null) return;
  if (!await ownsTribe(tribeId, req.user.id, res)) return;

  await db.delete(schema.tribes).where(eq(schema.tribes.id, tribeId));
  res.json({ ok: true });
});

module.exports = router;
