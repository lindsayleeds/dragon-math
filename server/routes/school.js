const express = require('express');
const crypto = require('crypto');
const { and, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const {
  requireAuth,
  requireParent,
  requireTeacher,
  requireSchoolAdmin,
} = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { inviteSchoolAdmin } = require('../lib/schoolAdminInvite');
const { randomCode } = require('../lib/joinCode');
const { localMinuteNow } = require('./playtime');
const { childLimit, childCountForAdult } = require('../lib/entitlements');

const MAX_REAL_NAME_LEN = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const IMPORT_MAX_ROWS = 500;

// Insert a classroom with a freshly minted, unique join code, retrying on the
// (rare) code collision. Mirrors the helper in server/routes/classroom.js; kept
// local so a school admin can create rooms on a teacher's behalf during import.
async function createClassroomWithCode(teacherId, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      const [row] = await db
        .insert(schema.classrooms)
        .values({ teacherId, name, joinCode })
        .returning({ id: schema.classrooms.id, name: schema.classrooms.name });
      return row;
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue; // join_code collision — retry
      throw err;
    }
  }
}

const router = express.Router();
router.use(requireAuth);

// The set of schools a given adult administers — powers the dashboard link and
// school picker. Shared by /mine and by /api/parent/me (see server/routes/parent.js).
async function schoolsAdministeredBy(userId) {
  const rows = await db
    .select({
      id: schema.schools.id,
      name: schema.schools.name,
      join_code: schema.schools.joinCode,
    })
    .from(schema.schoolAdmins)
    .innerJoin(schema.schools, eq(schema.schools.id, schema.schoolAdmins.schoolId))
    .where(eq(schema.schoolAdmins.userId, userId))
    .orderBy(schema.schools.name);
  return rows;
}

// =============================== Admin API ===============================

// GET /api/school/mine — schools this adult administers, with counts.
router.get('/mine', async (req, res) => {
  const schools = await schoolsAdministeredBy(req.user.id);
  if (schools.length === 0) return res.json({ schools: [] });
  const withCounts = await Promise.all(schools.map(async (s) => {
    const { rows } = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM school_teachers st WHERE st.school_id = ${s.id}) AS teacher_count,
        (SELECT COUNT(DISTINCT cm.child_id)::int
           FROM school_teachers st
           JOIN classrooms c ON c.teacher_id = st.user_id
           JOIN classroom_members cm ON cm.classroom_id = c.id
           WHERE st.school_id = ${s.id}) AS student_count
    `);
    return { ...s, teacher_count: rows[0]?.teacher_count ?? 0, student_count: rows[0]?.student_count ?? 0 };
  }));
  res.json({ schools: withCounts });
});

// School detail — join code, the admin roster, and the teacher roster with
// per-teacher classroom/student counts. Returns `{ school, admins, teachers }`
// (school is undefined if the id doesn't exist). Shared by the school-admin
// route below and the password-gated admin panel (server/routes/admin.js), so
// the super-admin drill-in shows exactly the same data a school admin sees.
async function schoolDetail(schoolId) {
  const [school] = await db
    .select({
      id: schema.schools.id,
      name: schema.schools.name,
      join_code: schema.schools.joinCode,
      created_at: schema.schools.createdAt,
    })
    .from(schema.schools)
    .where(eq(schema.schools.id, schoolId))
    .limit(1);

  const admins = await db.execute(sql`
    SELECT u.id, u.email, u.username, u.real_name, sa.created_at
    FROM school_admins sa
    JOIN users u ON u.id = sa.user_id
    WHERE sa.school_id = ${schoolId}
    ORDER BY COALESCE(u.real_name, u.email, u.username::text)
  `);

  const teachers = await db.execute(sql`
    SELECT t.id, t.email, t.username, st.created_at,
           t.login_token,
           (t.password_hash IS NOT NULL) AS has_password,
           (SELECT COUNT(*)::int FROM classrooms c WHERE c.teacher_id = t.id) AS classroom_count,
           (SELECT COUNT(DISTINCT cm.child_id)::int
              FROM classrooms c
              JOIN classroom_members cm ON cm.classroom_id = c.id
              WHERE c.teacher_id = t.id) AS student_count
    FROM school_teachers st
    JOIN users t ON t.id = st.user_id
    WHERE st.school_id = ${schoolId}
    ORDER BY COALESCE(t.email, t.username::text)
  `);

  return { school, admins: admins.rows, teachers: teachers.rows };
}

// Every student across the school's teachers' classrooms, with real name,
// handle, which class(es)/teacher(s), progress, and playtime across three
// windows. Correlated subqueries (not joins) keep the playtime counts honest
// when a kid is in more than one class. Shared like schoolDetail above.
async function schoolStudents(schoolId) {
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
    SELECT u.id, u.username, u.real_name, u.avatar, u.current_node_id, u.needs_handle,
           (SELECT COUNT(*)::int FROM user_dragons ud WHERE ud.user_id = u.id) AS dragons_collected,
           (SELECT string_agg(DISTINCT c.name, ', ')
              FROM school_teachers st
              JOIN classrooms c ON c.teacher_id = st.user_id
              JOIN classroom_members cm ON cm.classroom_id = c.id
              WHERE st.school_id = ${schoolId} AND cm.child_id = u.id) AS classrooms,
           (SELECT string_agg(DISTINCT COALESCE(t.email, t.username::text), ', ')
              FROM school_teachers st
              JOIN classrooms c ON c.teacher_id = st.user_id
              JOIN classroom_members cm ON cm.classroom_id = c.id
              JOIN users t ON t.id = st.user_id
              WHERE st.school_id = ${schoolId} AND cm.child_id = u.id) AS teachers,
           (SELECT COUNT(*)::int FROM play_minutes pm WHERE pm.user_id = u.id AND pm.minute >= ${weekCut})  AS week_minutes,
           (SELECT COUNT(*)::int FROM play_minutes pm WHERE pm.user_id = u.id AND pm.minute >= ${monthCut}) AS month_minutes,
           (SELECT COUNT(*)::int FROM play_minutes pm WHERE pm.user_id = u.id AND pm.minute >= ${yearCut})  AS year_minutes,
           (SELECT MAX(minute) FROM play_minutes pm WHERE pm.user_id = u.id) AS last_seen
    FROM users u
    WHERE u.id IN (
      SELECT DISTINCT cm.child_id
      FROM school_teachers st
      JOIN classrooms c ON c.teacher_id = st.user_id
      JOIN classroom_members cm ON cm.classroom_id = c.id
      WHERE st.school_id = ${schoolId}
    )
    ORDER BY u.needs_handle DESC, u.username
  `);

  return rows;
}

// GET /api/school/:schoolId — school detail for an admin: join code, the admin
// roster, and the teacher roster with per-teacher classroom/student counts.
router.get('/:schoolId', requireSchoolAdmin, async (req, res) => {
  res.json(await schoolDetail(req.schoolId));
});

// GET /api/school/:schoolId/students — every student across the school's teachers'
// classrooms, with real name, handle, which class(es)/teacher(s), progress, and
// playtime across three windows.
router.get('/:schoolId/students', requireSchoolAdmin, async (req, res) => {
  res.json({ students: await schoolStudents(req.schoolId) });
});

// POST /api/school/:schoolId/students/import — bulk-create students from a parsed
// CSV (the client parses the file; we take JSON rows). Each row targets a teacher
// (by email, who must already be attached to this school) and a class (by name,
// created for that teacher if it doesn't exist yet). real_name is required; handle
// is optional — a blank handle mints a "new adventurer" who picks their own handle
// on first login (mirrors POST /api/classroom/:id/students). Per-teacher plan
// child-limits are honored, counting rows added within the same import. Nothing is
// destructive: every row is create-or-error, and each new kid comes back with a
// login_token so the admin can hand out /k/<token> links.
router.post('/:schoolId/students/import', requireSchoolAdmin, async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `school-import:${req.user.id}:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many imports. Try again later.' });

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'Expected a "rows" array.' });
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });
  if (rows.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows — import at most ${IMPORT_MAX_ROWS} at a time.` });
  }

  // Teachers attached to this school, keyed by lowercased email. Only these can
  // receive imported students; a row naming anyone else is an error, never a
  // silent teacher-account creation.
  const teacherRows = await db.execute(sql`
    SELECT u.id, u.email, u.plan
    FROM school_teachers st
    JOIN users u ON u.id = st.user_id
    WHERE st.school_id = ${req.schoolId} AND u.email IS NOT NULL
  `);
  const teachersByEmail = new Map();
  for (const t of teacherRows.rows) teachersByEmail.set(t.email.toLowerCase(), t);

  // Running student count per teacher, seeded lazily from the DB, so the plan
  // child-limit is enforced across the whole batch — not just against the count
  // the teacher started at.
  const countByTeacher = new Map();
  async function seatsLeft(teacher) {
    if (!countByTeacher.has(teacher.id)) {
      countByTeacher.set(teacher.id, await childCountForAdult(teacher.id, 'teacher'));
    }
    return childLimit(teacher.plan) - countByTeacher.get(teacher.id); // Infinity for 'classroom'
  }

  // Cache resolved classrooms per (teacher, lower(name)) so a new room is created
  // once and its id reused for later rows in the same class.
  const classCache = new Map();
  const createdClasses = [];
  async function resolveClass(teacher, className) {
    const key = `${teacher.id}::${className.toLowerCase()}`;
    if (classCache.has(key)) return classCache.get(key);
    const found = await db.execute(sql`
      SELECT id, name FROM classrooms
      WHERE teacher_id = ${teacher.id} AND lower(name) = lower(${className})
      ORDER BY created_at ASC LIMIT 1
    `);
    let entry;
    if (found.rows.length) {
      entry = { id: found.rows[0].id, name: found.rows[0].name };
    } else {
      const room = await createClassroomWithCode(teacher.id, className);
      entry = { id: room.id, name: room.name };
      createdClasses.push({ teacher_email: teacher.email, class: room.name });
    }
    classCache.set(key, entry);
    return entry;
  }

  // Handles claimed within this batch (case-insensitive) — catches a duplicate
  // handle in the file before it races the citext-unique constraint.
  const batchHandles = new Set();
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const results = [];
  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {};
    const line = Number.isInteger(raw.line) ? raw.line : i + 2; // 1-based, incl. header
    const teacherEmail = str(raw.teacher_email).toLowerCase();
    const className = str(raw.class);
    const realName = str(raw.real_name);
    const handle = str(raw.handle);
    const fail = (reason) => results.push({ line, status: 'error', reason });

    if (!teacherEmail) { fail('Missing teacher email.'); continue; }
    if (!EMAIL_RE.test(teacherEmail)) { fail('Invalid teacher email.'); continue; }
    const teacher = teachersByEmail.get(teacherEmail);
    if (!teacher) { fail(`No teacher "${teacherEmail}" is in this school.`); continue; }
    if (!className) { fail('Missing class.'); continue; }
    if (className.length > 60) { fail('Class name too long (max 60).'); continue; }
    if (!realName) { fail('Missing real name.'); continue; }
    if (realName.length > MAX_REAL_NAME_LEN) { fail(`Real name too long (max ${MAX_REAL_NAME_LEN}).`); continue; }
    if (handle && !USERNAME_RE.test(handle)) { fail('Handle must be 2–24 letters, numbers, _ or -.'); continue; }
    if (handle && batchHandles.has(handle.toLowerCase())) { fail('Duplicate handle in this file.'); continue; }
    if ((await seatsLeft(teacher)) <= 0) {
      fail(`${teacherEmail} is at their plan's student limit.`);
      continue;
    }

    let room;
    try {
      room = await resolveClass(teacher, className);
    } catch {
      fail('Could not open that class.');
      continue;
    }

    const loginToken = crypto.randomUUID();
    const named = handle !== '';
    let child;
    try {
      child = await db.transaction(async (tx) => {
        const [ins] = await tx
          .insert(schema.users)
          .values({
            username: named ? handle : loginToken, // unnamed kids use the token as a placeholder
            accountType: 'child',
            loginToken,
            needsHandle: !named,
            realName,
          })
          .returning({ id: schema.users.id, username: schema.users.username });
        await tx
          .insert(schema.classroomMembers)
          .values({ classroomId: room.id, childId: ins.id })
          .onConflictDoNothing();
        return ins;
      });
    } catch (err) {
      if (err?.code === '23505' && named) { fail('Handle already taken.'); continue; }
      fail('Could not create this student.');
      continue;
    }

    if (named) batchHandles.add(handle.toLowerCase());
    countByTeacher.set(teacher.id, countByTeacher.get(teacher.id) + 1);
    created++;
    results.push({
      line,
      status: 'created',
      student: {
        id: child.id,
        username: named ? child.username : null,
        real_name: realName,
        needs_handle: !named,
        login_token: loginToken,
        teacher_email: teacher.email,
        class: room.name,
      },
    });
  }

  res.json({
    summary: {
      total: rows.length,
      created,
      errors: results.filter(r => r.status === 'error').length,
      created_classes: createdClasses,
    },
    results,
  });
});

// PATCH /api/school/:schoolId/students/:childId — set (or clear) a student's real
// name. Only for students actually in this school. Send "" to clear.
router.patch('/:schoolId/students/:childId', requireSchoolAdmin, async (req, res) => {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid student id' });
  }
  if (!('real_name' in (req.body || {}))) {
    return res.status(400).json({ error: 'real_name is required' });
  }
  const raw = typeof req.body.real_name === 'string' ? req.body.real_name.trim() : '';
  if (raw.length > MAX_REAL_NAME_LEN) {
    return res.status(400).json({ error: `Name must be at most ${MAX_REAL_NAME_LEN} characters.` });
  }

  // Confirm the child is actually a student in this school before editing.
  const inSchool = await db.execute(sql`
    SELECT 1
    FROM school_teachers st
    JOIN classrooms c ON c.teacher_id = st.user_id
    JOIN classroom_members cm ON cm.classroom_id = c.id
    WHERE st.school_id = ${req.schoolId} AND cm.child_id = ${childId}
    LIMIT 1
  `);
  if (inSchool.rows.length === 0) {
    return res.status(404).json({ error: 'Student not in this school' });
  }

  await db
    .update(schema.users)
    .set({ realName: raw || null })
    .where(and(eq(schema.users.id, childId), eq(schema.users.accountType, 'child')));
  res.json({ id: childId, real_name: raw || null });
});

// PATCH /api/school/:schoolId/admins/:userId — set (or clear) an admin's real
// name. Only for adults who actually administer this school. Send "" to clear.
router.patch('/:schoolId/admins/:userId', requireSchoolAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid admin id' });
  }
  if (!('real_name' in (req.body || {}))) {
    return res.status(400).json({ error: 'real_name is required' });
  }
  const raw = typeof req.body.real_name === 'string' ? req.body.real_name.trim() : '';
  if (raw.length > MAX_REAL_NAME_LEN) {
    return res.status(400).json({ error: `Name must be at most ${MAX_REAL_NAME_LEN} characters.` });
  }

  // Confirm the target actually administers this school before editing.
  const [row] = await db
    .select({ id: schema.schoolAdmins.userId })
    .from(schema.schoolAdmins)
    .where(and(
      eq(schema.schoolAdmins.schoolId, req.schoolId),
      eq(schema.schoolAdmins.userId, userId),
    ))
    .limit(1);
  if (!row) {
    return res.status(404).json({ error: 'Not an admin of this school' });
  }

  await db
    .update(schema.users)
    .set({ realName: raw || null })
    .where(and(eq(schema.users.id, userId), eq(schema.users.accountType, 'parent')));
  res.json({ id: userId, real_name: raw || null });
});

// POST /api/school/:schoolId/rotate-code — mint a fresh teacher join code.
router.post('/:schoolId/rotate-code', requireSchoolAdmin, async (req, res) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      await db
        .update(schema.schools)
        .set({ joinCode })
        .where(eq(schema.schools.id, req.schoolId));
      return res.json({ join_code: joinCode });
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
});

// POST /api/school/:schoolId/teachers — add a teacher to the school by email,
// no signup required. If no account has that email yet, create one (a 'parent'
// account with adult_role 'teacher') carrying a "login by URL" token, so the
// admin can hand them a /k/<token> link right away. If the account already
// exists, just attach it. Either way the email is the pivot: a teacher can also
// later click "Sign in with Google" with that same email and /api/auth/google
// merges onto this row — so URL and Google both work without picking a mode.
router.post('/:schoolId/teachers', requireSchoolAdmin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const realName = typeof req.body?.real_name === 'string' ? req.body.real_name.trim() : '';
  if (realName.length > MAX_REAL_NAME_LEN) {
    return res.status(400).json({ error: `Name must be at most ${MAX_REAL_NAME_LEN} characters.` });
  }

  // Existing adult account with this email? Attach it as-is — never touch its
  // credentials. Only surface a login link when the account signs in by URL
  // (has a token and no password); password/Google teachers use their own.
  const [existing] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      accountType: schema.users.accountType,
      loginToken: schema.users.loginToken,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing) {
    if (existing.accountType !== 'parent') {
      return res.status(409).json({ error: 'That email belongs to a non-teacher account.' });
    }
    const inserted = await db
      .insert(schema.schoolTeachers)
      .values({ schoolId: req.schoolId, userId: existing.id })
      .onConflictDoNothing()
      .returning({ userId: schema.schoolTeachers.userId });
    if (inserted.length === 0) {
      return res.status(409).json({ error: 'That teacher is already in this school.' });
    }
    const link = !existing.passwordHash && existing.loginToken ? `/k/${existing.loginToken}` : null;
    return res.status(200).json({
      created: false,
      login_link: link,
      teacher: { id: existing.id, email: existing.email, username: existing.username },
    });
  }

  // No account yet — mint a URL-login teacher. username = email mirrors the
  // parent-signup convention (kids can't type '@', so the namespaces can't
  // collide). No password: they log in by URL or by Google with this email.
  const loginToken = crypto.randomUUID();
  let created;
  try {
    created = await db.transaction(async (tx) => {
      const [ins] = await tx
        .insert(schema.users)
        .values({
          username: email,
          accountType: 'parent',
          adultRole: 'teacher',
          email,
          loginToken,
          emailVerified: false,
          ...(realName ? { realName } : {}),
        })
        .returning({ id: schema.users.id, email: schema.users.email, username: schema.users.username });
      await tx
        .insert(schema.schoolTeachers)
        .values({ schoolId: req.schoolId, userId: ins.id })
        .onConflictDoNothing();
      return ins;
    });
  } catch (err) {
    // Unique violation on email/username: someone signed up with it in the race.
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    throw err;
  }

  res.status(201).json({
    created: true,
    login_link: `/k/${loginToken}`,
    teacher: { id: created.id, email: created.email, username: created.username },
  });
});

// DELETE /api/school/:schoolId/teachers/:userId — detach a teacher from the
// school. Their classrooms and students are untouched; they just stop rolling
// up to this school.
router.delete('/:schoolId/teachers/:userId', requireSchoolAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }
  await db
    .delete(schema.schoolTeachers)
    .where(and(
      eq(schema.schoolTeachers.schoolId, req.schoolId),
      eq(schema.schoolTeachers.userId, userId),
    ));
  res.json({ ok: true });
});

// POST /api/school/:schoolId/admins — a school admin grants admin to another
// adult by email and emails them a welcome message. If no account owns the email
// yet we mint a passwordless "login by URL" account (like the teacher-add flow)
// and the email carries a unique /k/<token> link; an existing account is granted
// admin as-is and pointed at its usual sign-in.
router.post('/:schoolId/admins', requireSchoolAdmin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const result = await inviteSchoolAdmin({ schoolId: req.schoolId, email });
  if (result.error === 'school_not_found') return res.status(404).json({ error: 'School not found' });
  if (result.error === 'account_conflict') {
    return res.status(409).json({ error: 'That email belongs to a non-adult account.' });
  }
  if (result.error === 'already_admin') {
    return res.status(409).json({ error: 'That person is already an admin of this school.' });
  }
  if (result.error === 'race_exists') {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  res.status(201).json({
    admin: result.admin,
    created: result.created,
    login_link: result.login_link,
    email_sent: result.email_sent,
    email_error: result.email_error,
    bcc: result.bcc,
  });
});

// DELETE /api/school/:schoolId/admins/:userId — revoke another admin. Refuses to
// remove the last admin so a school can never be left with nobody who can manage
// it (that would require the site-admin panel to recover).
router.delete('/:schoolId/admins/:userId', requireSchoolAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid admin id' });
  }

  const [{ count }] = await db
    .select({ count: sql`COUNT(*)::int` })
    .from(schema.schoolAdmins)
    .where(eq(schema.schoolAdmins.schoolId, req.schoolId));
  if (count <= 1) {
    return res.status(400).json({ error: "Can't remove the last admin — a school needs at least one." });
  }

  await db
    .delete(schema.schoolAdmins)
    .where(and(
      eq(schema.schoolAdmins.schoolId, req.schoolId),
      eq(schema.schoolAdmins.userId, userId),
    ));
  res.json({ ok: true });
});

// =============================== Teacher API ==============================

// POST /api/school/join — { code } → attach the signed-in teacher to a school by
// its join code. All the teacher's classrooms then roll up to that school.
router.post('/join', requireParent, requireTeacher, async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `school-join:${req.user.id}:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const GENERIC = { error: "We couldn't find a school with that code." };
  if (!code) return res.status(400).json(GENERIC);

  const [school] = await db
    .select({ id: schema.schools.id, name: schema.schools.name })
    .from(schema.schools)
    .where(eq(schema.schools.joinCode, code))
    .limit(1);
  if (!school) return res.status(404).json(GENERIC);

  await db
    .insert(schema.schoolTeachers)
    .values({ schoolId: school.id, userId: req.user.id })
    .onConflictDoNothing();

  res.json({ school: { id: school.id, name: school.name } });
});

module.exports = { router, schoolsAdministeredBy, schoolDetail, schoolStudents };
