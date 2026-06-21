const express = require('express');
const crypto = require('crypto');
const { and, eq, inArray, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const {
  requireAuth,
  requireParent,
  requireTeacher,
  requireOwnsClassroom,
} = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { randomCode } = require('../lib/joinCode');
const { localMinuteNow } = require('./playtime');

const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;

const router = express.Router();
router.use(requireAuth);

// Count of active (non-retired) dragons in the catalog — the denominator for a
// classmate's "den" so it can render locked slots for un-collected dragons.
// dragon_catalog is the source of truth (see server/routes/dragons.js).
async function activeDragonCount() {
  const { rows } = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM dragon_catalog WHERE NOT retired
  `);
  return rows[0]?.n ?? 0;
}

// Insert a classroom with a freshly minted code, retrying on the unique
// constraint so a (rare) collision doesn't surface to the caller.
async function createClassroomWithCode(teacherId, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      const [row] = await db
        .insert(schema.classrooms)
        .values({ teacherId, name, joinCode })
        .returning({
          id: schema.classrooms.id,
          name: schema.classrooms.name,
          join_code: schema.classrooms.joinCode,
          created_at: schema.classrooms.createdAt,
        });
      return row;
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue; // join_code collision — retry
      throw err;
    }
  }
}

// =============================== Teacher API ===============================

const teacherOnly = [requireParent, requireTeacher];

// GET /api/classroom/mine — this teacher's classrooms with a student count.
router.get('/mine', teacherOnly, async (req, res) => {
  const rows = await db.execute(sql`
    SELECT c.id, c.name, c.join_code, c.created_at,
           (SELECT COUNT(*)::int FROM classroom_members cm WHERE cm.classroom_id = c.id) AS student_count
    FROM classrooms c
    WHERE c.teacher_id = ${req.user.id}
    ORDER BY c.created_at DESC
  `);
  res.json({ classrooms: rows.rows });
});

// POST /api/classroom — { name } → create a classroom for this teacher.
router.post('/', teacherOnly, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) {
    return res.status(400).json({ error: 'Class name must be 1–60 characters.' });
  }
  const classroom = await createClassroomWithCode(req.user.id, name);
  res.status(201).json({ classroom: { ...classroom, student_count: 0 } });
});

// POST /api/classroom/:classroomId/students — create a brand-new kid account
// already enrolled in this classroom. Mirrors POST /api/parent/children: the kid
// has no password and signs in by visiting /k/<login_token> (a QR code).
//
// Two flavors, by the optional `username` in the body:
//  - omitted → the kid picks their own handle after scanning (needs_handle true),
//    using a placeholder username until then.
//  - provided → the teacher names the kid up front, so the account is ready to go
//    (needs_handle false) with the default avatar the kid can change later.
router.post('/:classroomId/students', teacherOnly, requireOwnsClassroom, async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `create-student:${req.user.id}:${ip}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many new students. Try again later.' });

  const named = typeof req.body?.username === 'string' && req.body.username.trim() !== '';
  const handle = named ? req.body.username.trim() : null;
  if (named && !USERNAME_RE.test(handle)) {
    return res.status(400).json({ error: 'Name must be 2–24 letters, numbers, _ or -' });
  }

  // username is citext-unique; check first for a friendly message, then rely on
  // the constraint to settle any race below.
  if (named) {
    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, handle))
      .limit(1);
    if (taken.length > 0) {
      return res.status(409).json({ error: 'That name is already taken. Try another.' });
    }
  }

  const loginToken = crypto.randomUUID();
  let child;
  try {
    child = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.users)
        .values({
          // Named kids get their handle now; unnamed kids get the login token as a
          // 36-char placeholder, replaced when they pick a handle after scanning.
          username: named ? handle : loginToken,
          accountType: 'child',
          loginToken,
          needsHandle: !named,
        })
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          avatar: schema.users.avatar,
          current_node_id: schema.users.currentNodeId,
        });
      await tx
        .insert(schema.classroomMembers)
        .values({ classroomId: req.classroomId, childId: inserted.id })
        .onConflictDoNothing();
      return inserted;
    });
  } catch (err) {
    if (err?.code === '23505' && named) {
      return res.status(409).json({ error: 'That name is already taken. Try another.' });
    }
    throw err;
  }

  res.status(201).json({
    student: {
      id: child.id,
      username: named ? child.username : null,
      avatar: child.avatar,
      current_node_id: child.current_node_id,
      needs_handle: !named,
      login_token: loginToken,
      dragons_collected: 0,
    },
  });
});

// DELETE /api/classroom/:classroomId/students/:childId — remove a kid from the
// roster. Deletes the membership only; never deletes the child account.
router.delete('/:classroomId/students/:childId', teacherOnly, requireOwnsClassroom, async (req, res) => {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid student id' });
  }
  await db
    .delete(schema.classroomMembers)
    .where(and(
      eq(schema.classroomMembers.classroomId, req.classroomId),
      eq(schema.classroomMembers.childId, childId),
    ));
  res.json({ ok: true });
});

// POST /api/classroom/:classroomId/students/:childId/login-link — ensure a
// "login by URL" token exists for a student so the teacher can hand it out (or
// recover it). Kids who joined via the join code with their own account have no
// token; we mint one here. This is recovery, not rotation — an existing token is
// returned unchanged so a link the teacher already shared keeps working.
router.post('/:classroomId/students/:childId/login-link', teacherOnly, requireOwnsClassroom, async (req, res) => {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid student id' });
  }

  // requireOwnsClassroom only proves the teacher owns the room — confirm the
  // child is actually enrolled before minting a passwordless link for them.
  const [member] = await db
    .select({ id: schema.users.id, loginToken: schema.users.loginToken })
    .from(schema.classroomMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.classroomMembers.childId))
    .where(and(
      eq(schema.classroomMembers.classroomId, req.classroomId),
      eq(schema.classroomMembers.childId, childId),
    ))
    .limit(1);
  if (!member) return res.status(404).json({ error: 'Student not in this class' });

  let loginToken = member.loginToken;
  if (!loginToken) {
    loginToken = crypto.randomUUID();
    await db
      .update(schema.users)
      .set({ loginToken })
      .where(eq(schema.users.id, childId));
  }
  res.json({ login_token: loginToken });
});

// POST /api/classroom/:classroomId/rotate-code — mint a fresh join code.
router.post('/:classroomId/rotate-code', teacherOnly, requireOwnsClassroom, async (req, res) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      await db
        .update(schema.classrooms)
        .set({ joinCode })
        .where(eq(schema.classrooms.id, req.classroomId));
      return res.json({ join_code: joinCode });
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
});

// DELETE /api/classroom/:classroomId — delete the classroom (cascades the roster
// rows; the kid accounts themselves are untouched).
router.delete('/:classroomId', teacherOnly, requireOwnsClassroom, async (req, res) => {
  await db.delete(schema.classrooms).where(eq(schema.classrooms.id, req.classroomId));
  res.json({ ok: true });
});

// GET /api/classroom/:classroomId/stats — per-student playtime for this room
// across three windows (week/month/year), ranked by year minutes. Each row in
// play_minutes is one local minute the kid was actively in a battle, so a count
// of rows within a window is real engaged minutes (see server/routes/playtime.js).
router.get('/:classroomId/stats', teacherOnly, requireOwnsClassroom, async (req, res) => {
  const [classroom] = await db
    .select({ id: schema.classrooms.id, name: schema.classrooms.name })
    .from(schema.classrooms)
    .where(eq(schema.classrooms.id, req.classroomId))
    .limit(1);

  // Cutoffs = midnight local time, N-1 days ago, inclusive of today. minute is
  // stored as a sortable 'YYYY-MM-DD HH:MM' string so a lexical >= works.
  const cutoff = (days) => {
    const c = new Date();
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - (days - 1));
    return localMinuteNow(c);
  };
  const weekCut = cutoff(7);
  const monthCut = cutoff(30);
  const yearCut = cutoff(365);

  const { rows } = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.needs_handle,
           COUNT(*) FILTER (WHERE pm.minute >= ${weekCut})::int  AS week_minutes,
           COUNT(*) FILTER (WHERE pm.minute >= ${monthCut})::int AS month_minutes,
           COUNT(*) FILTER (WHERE pm.minute >= ${yearCut})::int  AS year_minutes,
           MAX(pm.minute) AS last_seen
    FROM classroom_members cm
    JOIN users u ON u.id = cm.child_id
    LEFT JOIN play_minutes pm ON pm.user_id = u.id
    WHERE cm.classroom_id = ${req.classroomId}
    GROUP BY u.id, u.username, u.avatar, u.needs_handle
    ORDER BY year_minutes DESC, u.username
  `);

  res.json({ classroom, students: rows });
});

// ================================ Kid API ================================

// Roster of one classroom, ranked by dragons collected (desc), ties broken by
// who got their most-recent dragon first. Used by both /me and the classmate
// view so a kid's rank is consistent everywhere.
async function classroomRoster(classroomId) {
  const rows = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.needs_handle,
           COUNT(ud.dragon_id)::int AS dragons_collected,
           MIN(ud.first_acquired_at) AS first_dragon_at,
           (RANK() OVER (
             ORDER BY COUNT(ud.dragon_id) DESC, MIN(ud.first_acquired_at) ASC NULLS LAST
           ))::int AS rank
    FROM classroom_members cm
    JOIN users u ON u.id = cm.child_id
    LEFT JOIN user_dragons ud ON ud.user_id = u.id
    WHERE cm.classroom_id = ${classroomId}
    GROUP BY u.id, u.username, u.avatar, u.current_node_id, u.needs_handle
    ORDER BY rank, u.username
  `);
  return rows.rows;
}

// GET /api/classroom/me — the kid's classroom(s) with the ranked roster of each.
// The kid's own row is included so the UI can highlight "you".
router.get('/me', async (req, res) => {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only adventurers have classmates' });
  }
  const memberships = await db
    .select({ classroomId: schema.classroomMembers.classroomId })
    .from(schema.classroomMembers)
    .where(eq(schema.classroomMembers.childId, req.user.id));

  if (memberships.length === 0) return res.json({ classrooms: [] });

  const ids = memberships.map(m => m.classroomId);
  const classroomRows = await db
    .select({ id: schema.classrooms.id, name: schema.classrooms.name })
    .from(schema.classrooms)
    .where(inArray(schema.classrooms.id, ids));

  const classrooms = await Promise.all(
    classroomRows.map(async (c) => ({
      id: c.id,
      name: c.name,
      classmates: await classroomRoster(c.id),
    })),
  );
  res.json({ classrooms });
});

// POST /api/classroom/join — { code } → enroll the signed-in kid in the class.
router.post('/join', async (req, res) => {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only adventurers can join a class' });
  }
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `class-join:${req.user.id}:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const GENERIC = { error: "We couldn't find a class with that code." };
  if (!code) return res.status(400).json(GENERIC);

  const [classroom] = await db
    .select({ id: schema.classrooms.id, name: schema.classrooms.name })
    .from(schema.classrooms)
    .where(eq(schema.classrooms.joinCode, code))
    .limit(1);
  if (!classroom) return res.status(404).json(GENERIC);

  await db
    .insert(schema.classroomMembers)
    .values({ classroomId: classroom.id, childId: req.user.id })
    .onConflictDoNothing();

  res.json({ classroom });
});

// GET /api/classroom/classmate/:childId — a classmate's public profile + their
// collected dragons + class rank. Viewable only if the viewer shares a classroom
// with the target.
router.get('/classmate/:childId', async (req, res) => {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only adventurers have classmates' });
  }
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid student id' });
  }

  // Shared-classroom check: at least one classroom holds both the viewer and the
  // target. Also yields the (best) rank to surface on the profile.
  const shared = await db.execute(sql`
    SELECT cm_t.classroom_id
    FROM classroom_members cm_v
    JOIN classroom_members cm_t ON cm_t.classroom_id = cm_v.classroom_id
    WHERE cm_v.child_id = ${req.user.id} AND cm_t.child_id = ${childId}
    LIMIT 1
  `);
  if (shared.rows.length === 0) {
    return res.status(403).json({ error: 'Not in your class' });
  }
  const classroomId = shared.rows[0].classroom_id;

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

  const roster = await classroomRoster(classroomId);
  const rankRow = roster.find(r => r.id === childId);

  res.json({
    student: {
      ...profile,
      needs_handle: !!profile.needs_handle,
      rank: rankRow?.rank ?? null,
      class_size: roster.length,
      dragons_collected: rankRow?.dragons_collected ?? dragons.rows.length,
    },
    owned: dragons.rows,
    total_dragons: await activeDragonCount(),
  });
});

// GET /api/classroom/:classroomId — classroom detail + roster (teacher view).
// Defined LAST so the literal kid routes above (/me, /join, /classmate/:id) are
// matched first — this Express router resolves by definition order and doesn't
// support inline param regex to disambiguate /:classroomId from /me.
router.get('/:classroomId', teacherOnly, requireOwnsClassroom, async (req, res) => {
  const [classroom] = await db
    .select({
      id: schema.classrooms.id,
      name: schema.classrooms.name,
      join_code: schema.classrooms.joinCode,
      created_at: schema.classrooms.createdAt,
    })
    .from(schema.classrooms)
    .where(eq(schema.classrooms.id, req.classroomId))
    .limit(1);

  const students = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.needs_handle, u.login_token,
           (SELECT COUNT(*)::int FROM user_dragons ud WHERE ud.user_id = u.id) AS dragons_collected
    FROM classroom_members cm
    JOIN users u ON u.id = cm.child_id
    WHERE cm.classroom_id = ${req.classroomId}
    ORDER BY u.needs_handle DESC, u.username
  `);

  res.json({ classroom, students: students.rows });
});

module.exports = router;
