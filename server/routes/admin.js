const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { and, asc, eq, sql } = require('drizzle-orm');
const { db, schema, withLongQueryBudget } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');
const { buildAnalytics } = require('../lib/analytics');
const { compPlanForRole } = require('../lib/entitlements');
const { trialFunnel } = require('../lib/billingEvents');
const { localDayString } = require('./playtime');
const { maxArtId, writeArt, removeArt } = require('../lib/dragonArt');
const { randomCode } = require('../lib/joinCode');
const { inviteSchoolAdmin } = require('../lib/schoolAdminInvite');
const { schoolDetail, schoolStudents } = require('./school');

const router = express.Router();
router.use(requireAdmin);

const MIN_GRID = 2;
const MAX_GRID = 10;
const MAX_RANGE = 999;
const MIN_AI_SECONDS = 0.5;
const MAX_AI_SECONDS = 60;
const VALID_OPS = ['add', 'sub', 'mul', 'div'];
// Allowed battle-grid shapes — must stay in sync with BATTLE_SHAPES in
// src/data/battleShapes.js. We keep the list server-side so admin PUTs can't
// inject an arbitrary shape_id that the client doesn't know how to render.
const VALID_SHAPE_IDS = new Set([
  'diamond', 'diamond-mini', 'hexagon', 'plus', 'plus-big', 'cross-x',
  'heart', 'flower', 'sun', 'moon-crescent', 'butterfly', 'bee-stripes',
  'tree', 'mushroom', 'leaf', 'cloud', 'mountain', 'wave', 'fish',
  'gem', 'crystal', 'honeycomb', 'star', 'crown', 'arrow-up', 'ring',
  'staircase', 'anchor-t', 'letter-h', 'zigzag-z',
  'triangle-up', 'triangle-down', 'letter-l', 'letter-t', 'bowtie',
  'chevron', 'kite-small', 'boat', 'acorn', 'berries',
]);
// Collectible-dragon rarities. Must stay in sync with the CHECK constraint on
// dragon_catalog.rarity (server/db/schema.js) and RARITY_KEYS in
// src/data/dragonRarity.js.
const VALID_RARITIES = new Set(['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'mythic']);
const MAX_DRAGON_NAME_LEN = 40;
const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const BCRYPT_ROUNDS = 12;
const VALID_ADULT_ROLES = ['parent', 'teacher'];
// Monetization tiers — must stay in sync with server/lib/entitlements.js.
const VALID_PLANS = ['free', 'premium', 'classroom'];
// Paid tiers a "lifetime free" comp can grant (never 'free').
const COMP_PLANS = ['premium', 'classroom'];

// GET /api/admin/check — used by the admin UI to validate the password.
router.get('/check', (req, res) => {
  res.json({ ok: true });
});

// POST /api/admin/reset-progress — wipe the signed-in user's progress and
// practice history. Requires both admin password (router-level) and a valid
// user JWT (so we know whose data to clear).
router.post('/reset-progress', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;

  const deleted = await db.transaction(async (tx) => {
    const np = await tx
      .delete(schema.nodeProgress)
      .where(eq(schema.nodeProgress.userId, userId))
      .returning({ id: schema.nodeProgress.id });
    const pa = await tx
      .delete(schema.problemAttempts)
      .where(eq(schema.problemAttempts.userId, userId))
      .returning({ id: schema.problemAttempts.id });
    const wt = await tx
      .delete(schema.wrongTaps)
      .where(eq(schema.wrongTaps.userId, userId))
      .returning({ id: schema.wrongTaps.id });
    await tx
      .update(schema.users)
      .set({ currentNodeId: 1 })
      .where(eq(schema.users.id, userId));
    return {
      node_progress: np.length,
      problem_attempts: pa.length,
      wrong_taps: wt.length,
    };
  });

  res.json({ ok: true, username, deleted });
});

// POST /api/admin/users — create a new child account.
router.post('/users', async (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw)) {
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, raw))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

  // Give every hand-created child a permanent "login by URL" secret so the
  // admin can hand them a /k/<token> link (or QR) right away, matching the
  // parent/teacher creation flows.
  const loginToken = crypto.randomUUID();

  const [inserted] = await db
    .insert(schema.users)
    .values({ username: raw, loginToken })
    .returning({ id: schema.users.id });

  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      current_node_id: schema.users.currentNodeId,
      login_token: schema.users.loginToken,
      created_at: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, inserted.id))
    .limit(1);
  res.status(201).json({ user });
});

// POST /api/admin/users/:userId/promote — set a child's current map node.
// Also marks every node before the target as completed (3 stars) so the map
// shows the path-so-far filled in. Existing node_progress rows are preserved
// (we MAX the star count rather than overwrite).
router.post('/users/:userId/promote', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id must be a positive integer' });
  }
  const exists = await db
    .select({ node_id: schema.nodeConfig.nodeId })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  if (exists.length === 0) return res.status(400).json({ error: `Unknown node_id ${nodeId}` });

  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      current_node_id: schema.users.currentNodeId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ currentNodeId: nodeId })
      .where(eq(schema.users.id, userId));

    for (let n = 1; n < nodeId; n++) {
      await tx
        .insert(schema.nodeProgress)
        .values({ userId, nodeId: n, completed: true, stars: 3, completedAt: now })
        .onConflictDoUpdate({
          target: [schema.nodeProgress.userId, schema.nodeProgress.nodeId],
          set: {
            completed: true,
            stars: sql`GREATEST(COALESCE(${schema.nodeProgress.stars}, 0), excluded.stars)`,
            completedAt: sql`COALESCE(${schema.nodeProgress.completedAt}, excluded.completed_at)`,
          },
        });
    }
  });

  res.json({ ok: true, user_id: userId, username: user.username, current_node_id: nodeId });
});

// POST /api/admin/users/:userId/reset-trial — clear a child's one-time
// Dragon's Trial flag so they can retake the placement test. Does NOT roll
// back the previous trial's promotion (kid keeps any progress they earned).
router.post('/users/:userId/reset-trial', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const result = await db
    .update(schema.users)
    .set({ dragonTrialCompleted: false })
    .where(and(
      eq(schema.users.id, userId),
      eq(schema.users.accountType, 'child'),
    ))
    .returning({ id: schema.users.id });
  if (result.length === 0) {
    return res.status(404).json({ error: 'Child not found' });
  }
  res.json({ ok: true });
});

// POST /api/admin/users/:userId/login-token — mint a fresh "login by URL"
// secret for any user (kids, and parents/teachers for testing). Used to give
// legacy accounts a link or rotate one that may have leaked. Any previously-
// shared link stops working immediately.
router.post('/users/:userId/login-token', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const loginToken = crypto.randomUUID();
  const result = await db
    .update(schema.users)
    .set({ loginToken })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  if (result.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ ok: true, login_token: loginToken });
});

// GET /api/admin/users — list of users for analytics picker. Per-user counts
// come from correlated subqueries; substr(minute, 1, 10) takes the 'YYYY-MM-DD'
// date prefix off `play_minutes.minute`. Username is citext so ORDER BY username is
// case-insensitive by default.
//
// This and /accounts below are the only statements in the app that scan every
// user and run four correlated subqueries per row, so they are the ones whose
// cost grows with the whole roster rather than with one child's data. They are
// well inside the pool-wide statement timeout today, but they are the plausible
// future offenders, and an operator waiting on their own report is better
// served by a slow answer than an error — so they get the raised budget
// (withLongQueryBudget, server/db.js). Nothing a *user* waits on does.
router.get('/users', async (req, res) => {
  const todayStr = localDayString();
  const result = await withLongQueryBudget(tx => tx.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           (SELECT COUNT(*)::int FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*)::int FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = ${todayStr}) AS minutes_today,
           (SELECT COUNT(*)::int FROM play_minutes WHERE user_id = u.id) AS minutes_total
    FROM users u
    ORDER BY u.username
  `));
  res.json({ users: result.rows });
});

// GET /api/admin/accounts — full roster of parents and children for the
// admin overview.
router.get('/accounts', async (req, res) => {
  const todayStr = localDayString();
  // Both rosters share one checked-out client so they share the raised budget
  // — and one pool slot instead of two. See the note on /users above.
  const { parents, children } = await withLongQueryBudget(async (tx) => {
    const parentsRes = await tx.execute(sql`
      SELECT u.id, u.email, u.username, u.email_verified, u.weekly_report_enabled,
             u.adult_role, u.plan, u.comped, u.plan_status, u.created_at, u.login_token,
             (SELECT COUNT(*)::int FROM parent_child_links WHERE parent_id = u.id) AS kid_count,
             (SELECT COUNT(DISTINCT cm.child_id)::int
                FROM classrooms c
                JOIN classroom_members cm ON cm.classroom_id = c.id
                WHERE c.teacher_id = u.id) AS student_count
      FROM users u
      WHERE u.account_type = 'parent'
      ORDER BY u.created_at DESC
    `);

    const childrenRes = await tx.execute(sql`
      SELECT u.id, u.username, u.real_name, u.avatar, u.current_node_id, u.created_at,
             u.dragon_trial_completed, u.login_token, u.needs_handle,
             (SELECT COUNT(*)::int FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
             (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
             (SELECT COUNT(*)::int FROM play_minutes
                WHERE user_id = u.id
                  AND substr(minute, 1, 10) = ${todayStr}) AS minutes_today,
             (SELECT string_agg(COALESCE(p.email, p.username::text), ', ')
                FROM parent_child_links pcl
                JOIN users p ON p.id = pcl.parent_id
                WHERE pcl.child_id = u.id) AS parent_emails
      FROM users u
      WHERE u.account_type = 'child'
      ORDER BY u.username
    `);

    return { parents: parentsRes.rows, children: childrenRes.rows };
  });

  res.json({ parents, children });
});

// GET /api/admin/teachers/:teacherId/students — one teacher's roster, grouped
// by classroom, for the admin accounts view. A kid enrolled in two of the
// teacher's rooms appears under each; the accounts list's `student_count` is the
// DISTINCT tally, so the two numbers can differ (and that's expected).
router.get('/teachers/:teacherId/students', async (req, res) => {
  const teacherId = parseInt(req.params.teacherId, 10);
  if (!Number.isInteger(teacherId) || teacherId <= 0) {
    return res.status(400).json({ error: 'Invalid teacher id' });
  }

  const [teacher] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      adult_role: schema.users.adultRole,
      account_type: schema.users.accountType,
    })
    .from(schema.users)
    .where(eq(schema.users.id, teacherId))
    .limit(1);
  if (!teacher || teacher.account_type !== 'parent') {
    return res.status(404).json({ error: 'Teacher not found' });
  }

  const rows = await db.execute(sql`
    SELECT c.id AS classroom_id, c.name AS classroom_name, c.join_code,
           u.id, u.username, u.real_name, u.avatar, u.current_node_id,
           u.needs_handle, u.dragon_trial_completed, u.login_token,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at
    FROM classrooms c
    LEFT JOIN classroom_members cm ON cm.classroom_id = c.id
    LEFT JOIN users u ON u.id = cm.child_id
    WHERE c.teacher_id = ${teacherId}
    ORDER BY c.created_at, u.needs_handle DESC, u.username
  `);

  // Group flat rows into classrooms → students. A room with no members still
  // shows up (empty roster) via the LEFT JOIN's null student row.
  const byRoom = new Map();
  for (const r of rows.rows) {
    if (!byRoom.has(r.classroom_id)) {
      byRoom.set(r.classroom_id, {
        classroom_id: r.classroom_id,
        classroom_name: r.classroom_name,
        join_code: r.join_code,
        students: [],
      });
    }
    if (r.id != null) {
      byRoom.get(r.classroom_id).students.push({
        id: r.id,
        username: r.username,
        real_name: r.real_name,
        avatar: r.avatar,
        current_node_id: r.current_node_id,
        needs_handle: r.needs_handle,
        dragon_trial_completed: r.dragon_trial_completed,
        login_token: r.login_token,
        last_attempt_at: r.last_attempt_at,
      });
    }
  }

  res.json({ teacher, classrooms: Array.from(byRoom.values()) });
});

// GET /api/admin/parents/:parentId/children — the children linked to one parent
// via parent_child_links, for the admin accounts view. The accounts list's
// `kid_count` is the count of these same rows, so the two always agree. A child
// with more than one guardian appears under each of their parents.
router.get('/parents/:parentId/children', async (req, res) => {
  const parentId = parseInt(req.params.parentId, 10);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    return res.status(400).json({ error: 'Invalid parent id' });
  }

  const [parent] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      adult_role: schema.users.adultRole,
      account_type: schema.users.accountType,
    })
    .from(schema.users)
    .where(eq(schema.users.id, parentId))
    .limit(1);
  if (!parent || parent.account_type !== 'parent') {
    return res.status(404).json({ error: 'Parent not found' });
  }

  const rows = await db.execute(sql`
    SELECT u.id, u.username, u.real_name, u.avatar, u.current_node_id,
           u.needs_handle, u.dragon_trial_completed, u.login_token,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at
    FROM parent_child_links pcl
    JOIN users u ON u.id = pcl.child_id
    WHERE pcl.parent_id = ${parentId}
    ORDER BY u.needs_handle DESC, u.username
  `);

  res.json({ parent, children: rows.rows });
});

// GET /api/admin/email-log — recent weekly-digest send attempts, newest first,
// so delivery failures are visible without querying the DB or grepping logs.
// `status` is 'sent' | 'stubbed' | 'failed' | 'pending'; `error` is set on
// failures. (School-admin invite failures aren't logged here — those surface in
// the invite receipt modal and the [schoolAdminInvite] server logs.)
router.get('/email-log', async (req, res) => {
  const result = await db.execute(sql`
    SELECT l.id, l.period_start, l.period_end, l.status, l.error,
           l.sent_at, u.email AS parent_email
    FROM weekly_report_log l
    LEFT JOIN users u ON u.id = l.parent_id
    ORDER BY l.id DESC
    LIMIT 200
  `);
  const failed = result.rows.filter((r) => r.status === 'failed').length;
  res.json({ log: result.rows, failed_count: failed });
});

// GET /api/admin/funnel — trial conversion, for the founder (GAPS 6a).
//
// Lives here rather than in the parent/school analytics because it is a
// business-health view, not a child-progress one: per the auth boundaries in
// CLAUDE.md, this is the password-gated admin surface and it reuses the shared
// helper instead of widening any per-resource guard. `recent` is the raw tail of
// the log so a suspicious count can be traced back to individual Stripe events.
router.get('/funnel', async (req, res) => {
  try {
    const summary = await trialFunnel();
    const recent = await db.execute(sql`
      SELECT e.id, e.event, e.plan, e.occurred_at, e.stripe_subscription_id,
             e.stripe_event_id, u.email AS parent_email
      FROM billing_events e
      LEFT JOIN users u ON u.id = e.user_id
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT 100
    `);
    res.json({ summary, recent: recent.rows });
  } catch (err) {
    // The one failure worth naming rather than leaving as a generic 500: there
    // are no committed migrations, so `billing_events` exists only after
    // deploy/db-push.sh has run against this environment. Between deploying this
    // code and running that push, this is the expected error — and Postgres's
    // 42P01 says so precisely, so say it back instead of making the operator
    // guess from an HTML error page. Writes are unaffected: recordBillingEvent
    // swallows the same failure so webhooks stay healthy.
    if (err?.code === '42P01') {
      return res.status(503).json({
        error: 'The billing_events table does not exist yet — run deploy/db-push.sh '
             + 'for this environment. No billing state is affected; nothing is being recorded.',
      });
    }
    throw err;
  }
});

// POST /api/admin/users/:userId/plan — manually set an adult's monetization tier.
// This is the Phase-1 "billing": grant Premium/Classroom by hand until Stripe lands.
router.post('/users/:userId/plan', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const plan = typeof req.body?.plan === 'string' ? req.body.plan : '';
  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: `plan must be one of: ${VALID_PLANS.join(', ')}` });
  }

  const [target] = await db
    .select({ id: schema.users.id, account_type: schema.users.accountType })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.account_type !== 'parent') {
    return res.status(400).json({ error: 'Plans apply to adult (parent/teacher) accounts only.' });
  }

  await db
    .update(schema.users)
    .set({ plan, planUpdatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  res.json({ id: userId, plan });
});

// POST /api/admin/users/:userId/comp — grant or revoke a "lifetime free" comp on
// an existing adult. Body: { comped: boolean, plan?: 'premium'|'classroom' }.
// Granting sets a permanent paid plan (auto by role unless overridden) that the
// Stripe webhook won't touch (see server/routes/billing.js). Revoking drops the
// account back to free.
router.post('/users/:userId/comp', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const comped = req.body?.comped === true;
  const planOverride = typeof req.body?.plan === 'string' ? req.body.plan : '';
  if (comped && planOverride && !COMP_PLANS.includes(planOverride)) {
    return res.status(400).json({ error: `plan must be one of: ${COMP_PLANS.join(', ')}` });
  }

  const [target] = await db
    .select({
      id: schema.users.id,
      account_type: schema.users.accountType,
      adult_role: schema.users.adultRole,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.account_type !== 'parent') {
    return res.status(400).json({ error: 'Comps apply to adult (parent/teacher) accounts only.' });
  }

  const plan = comped
    ? (planOverride || compPlanForRole(target.adult_role))
    : 'free';
  await db
    .update(schema.users)
    .set({
      comped,
      plan,
      planStatus: comped ? 'comped' : null,
      planRenewsAt: null,
      planCancelAtPeriodEnd: false,
      planUpdatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  res.json({ id: userId, comped, plan });
});

// ------------------------- Comp invites (lifetime free) -------------------------
// Shape a comp_invites row for the admin client.
function compInviteJson(r) {
  return {
    id: r.id,
    token: r.token,
    role: r.role,
    plan: r.plan, // null = auto by role
    note: r.note || '',
    created_at: r.createdAt,
    redeemed_by_user_id: r.redeemedByUserId,
    redeemed_at: r.redeemedAt,
    revoked_at: r.revokedAt,
  };
}

// GET /api/admin/comp-invites — list all comp invites, newest first.
router.get('/comp-invites', async (req, res) => {
  const rows = await db
    .select()
    .from(schema.compInvites)
    .orderBy(sql`${schema.compInvites.createdAt} DESC`);
  res.json({ invites: rows.map(compInviteJson) });
});

// POST /api/admin/comp-invites — mint a single-use "lifetime free" invite.
// Body: { role?: 'parent'|'teacher', plan?: 'premium'|'classroom', note?: string }.
router.post('/comp-invites', async (req, res) => {
  const role = req.body?.role === 'teacher' ? 'teacher' : 'parent';
  const planOverride = typeof req.body?.plan === 'string' ? req.body.plan : '';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
  if (planOverride && !COMP_PLANS.includes(planOverride)) {
    return res.status(400).json({ error: `plan must be one of: ${COMP_PLANS.join(', ')}` });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const [row] = await db
    .insert(schema.compInvites)
    .values({ token, role, plan: planOverride || null, note: note || null })
    .returning();
  res.status(201).json(compInviteJson(row));
});

// DELETE /api/admin/comp-invites/:id — revoke an unredeemed invite (stamps
// revoked_at). Already-redeemed invites are kept for the audit trail; revoking
// them has no effect on the account created.
router.delete('/comp-invites/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid invite id' });
  }
  const [row] = await db
    .update(schema.compInvites)
    .set({ revokedAt: new Date() })
    .where(eq(schema.compInvites.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: 'Invite not found' });
  res.json(compInviteJson(row));
});

// ------------------------------ Schools ------------------------------
// A school is the org layer above teachers: 1+ admins get a read view over every
// student across the school's teachers' classrooms. Provisioned here by the site
// admin (B2B/sales motion); teachers attach by entering the join code, and admins
// are any existing adult account. See server/routes/school.js for the admin/
// teacher-facing API, and server/db/schema.js for the data model.

// Insert a school with a freshly minted join code, retrying on the unique
// constraint so a (rare) collision doesn't surface to the caller.
async function createSchoolWithCode(name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = randomCode();
    try {
      const [row] = await db
        .insert(schema.schools)
        .values({ name, joinCode })
        .returning({
          id: schema.schools.id,
          name: schema.schools.name,
          join_code: schema.schools.joinCode,
          created_at: schema.schools.createdAt,
        });
      return row;
    } catch (err) {
      if (err?.code === '23505' && attempt < 4) continue; // join_code collision — retry
      throw err;
    }
  }
}

// GET /api/admin/schools — every school with admin/teacher/student counts.
router.get('/schools', async (req, res) => {
  const { rows } = await db.execute(sql`
    SELECT s.id, s.name, s.join_code, s.created_at,
           (SELECT COUNT(*)::int FROM school_admins sa WHERE sa.school_id = s.id) AS admin_count,
           (SELECT COUNT(*)::int FROM school_teachers st WHERE st.school_id = s.id) AS teacher_count,
           (SELECT COUNT(DISTINCT cm.child_id)::int
              FROM school_teachers st
              JOIN classrooms c ON c.teacher_id = st.user_id
              JOIN classroom_members cm ON cm.classroom_id = c.id
              WHERE st.school_id = s.id) AS student_count,
           (SELECT string_agg(COALESCE(u.email, u.username::text), ', ' ORDER BY u.email)
              FROM school_admins sa
              JOIN users u ON u.id = sa.user_id
              WHERE sa.school_id = s.id) AS admin_emails
    FROM schools s
    ORDER BY s.created_at DESC
  `);
  res.json({ schools: rows });
});

// GET /api/admin/schools/:schoolId — one school's detail (join code + admin and
// teacher rosters), the same shape the school admin's own dashboard loads from
// GET /api/school/:schoolId. Authorized by the admin password (requireAdmin
// above), NOT by school_admins membership — this lets a super-admin drill into
// any school from the /admin panel without touching the requireSchoolAdmin check
// that scopes real school admins to their own school. Reuses schoolDetail() so
// the data stays a single source of truth.
router.get('/schools/:schoolId', async (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Invalid school id' });
  }
  const detail = await schoolDetail(schoolId);
  if (!detail.school) return res.status(404).json({ error: 'School not found' });
  res.json(detail);
});

// GET /api/admin/schools/:schoolId/students — every student across the school's
// teachers, the same shape as GET /api/school/:schoolId/students. Password-gated
// like the detail endpoint above.
router.get('/schools/:schoolId/students', async (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Invalid school id' });
  }
  res.json({ students: await schoolStudents(schoolId) });
});

// POST /api/admin/schools — create a school. Body: { name, admin_emails?: string[] }.
// Each listed email is invited as an admin the same way as the add-admin
// endpoints: an existing adult account is granted admin, an unknown email gets a
// freshly minted passwordless account, and both are emailed a welcome message.
// Emails we couldn't add (invalid, or belonging to a non-adult account) come back
// in `skipped` with a reason.
router.post('/schools', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 120) {
    return res.status(400).json({ error: 'School name must be 1–120 characters.' });
  }
  const emails = Array.isArray(req.body?.admin_emails)
    ? req.body.admin_emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];

  const school = await createSchoolWithCode(name);

  const added = [];
  const skipped = [];
  let bcc = null;
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) { skipped.push({ email, reason: 'not a valid email' }); continue; }
    const result = await inviteSchoolAdmin({ schoolId: school.id, email });
    if (result.error) {
      const reason = result.error === 'account_conflict' ? 'belongs to a non-adult account'
        : result.error === 'already_admin' ? 'already an admin'
        : result.error === 'race_exists' ? 'account was just created elsewhere'
        : 'could not be added';
      skipped.push({ email, reason });
      continue;
    }
    if (result.bcc) bcc = result.bcc;
    added.push({
      email: result.admin.email || email,
      created: result.created,
      login_link: result.login_link,
      email_sent: result.email_sent,
      email_error: result.email_error,
    });
  }

  res.status(201).json({
    school: { ...school, admin_count: added.length, teacher_count: 0, student_count: 0 },
    added,
    skipped,
    bcc,
  });
});

// POST /api/admin/schools/:schoolId/admins — grant admin by email and email them
// a welcome message. If no account owns the email yet we mint a passwordless
// "login by URL" account and the email carries a unique /k/<token> link; an
// existing account is granted admin as-is and pointed at its usual sign-in.
router.post('/schools/:schoolId/admins', async (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Invalid school id' });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const result = await inviteSchoolAdmin({ schoolId, email });
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

// DELETE /api/admin/schools/:schoolId/admins/:userId — revoke admin.
router.delete('/schools/:schoolId/admins/:userId', async (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(schoolId) || schoolId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  await db
    .delete(schema.schoolAdmins)
    .where(and(
      eq(schema.schoolAdmins.schoolId, schoolId),
      eq(schema.schoolAdmins.userId, userId),
    ));
  res.json({ ok: true });
});

// DELETE /api/admin/schools/:schoolId — delete a school. Cascades the admin and
// teacher membership rows; teacher/child accounts and classrooms are untouched.
router.delete('/schools/:schoolId', async (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Invalid school id' });
  }
  await db.delete(schema.schools).where(eq(schema.schools.id, schoolId));
  res.json({ ok: true });
});

// POST /api/admin/adults — hand-create a parent/guardian or teacher account.
router.post('/adults', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = typeof req.body?.role === 'string' ? req.body.role : '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }
  if (!VALID_ADULT_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ADULT_ROLES.join(', ')}` });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const [inserted] = await db
    .insert(schema.users)
    .values({
      username: email,
      accountType: 'parent',
      email,
      passwordHash: hash,
      emailVerified: true,
      adultRole: role,
    })
    .returning({ id: schema.users.id });

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      email_verified: schema.users.emailVerified,
      weekly_report_enabled: schema.users.weeklyReportEnabled,
      adult_role: schema.users.adultRole,
      created_at: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, inserted.id))
    .limit(1);
  res.status(201).json({ user: { ...user, kid_count: 0 } });
});

// DELETE /api/admin/adults/:userId — permanently delete a parent/teacher account.
// Most references cascade (parent_child_links, classrooms, school memberships,
// tribes, weekly_report_log; comp_invites.redeemed_by is set null). The handful
// of child-data tables that reference users without ON DELETE CASCADE
// (node_progress, problem_attempts, wrong_taps, user_companions, play_minutes,
// matches) shouldn't hold rows for an adult, but we clear them defensively so a
// stray row can't block the delete. Linked children are NOT deleted — only the
// parent_child_links rows go, so a child shared with another guardian survives.
router.delete('/adults/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const [target] = await db
    .select({ id: schema.users.id, account_type: schema.users.accountType })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.account_type !== 'parent') {
    return res.status(400).json({ error: 'This endpoint deletes adult (parent/teacher) accounts only.' });
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.nodeProgress).where(eq(schema.nodeProgress.userId, userId));
    await tx.delete(schema.problemAttempts).where(eq(schema.problemAttempts.userId, userId));
    await tx.delete(schema.wrongTaps).where(eq(schema.wrongTaps.userId, userId));
    await tx.delete(schema.userCompanions).where(eq(schema.userCompanions.userId, userId));
    await tx.delete(schema.playMinutes).where(eq(schema.playMinutes.userId, userId));
    await tx.delete(schema.matches).where(eq(schema.matches.userId, userId));
    await tx.update(schema.matches)
      .set({ opponentUserId: null })
      .where(eq(schema.matches.opponentUserId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });

  res.json({ ok: true });
});

// DELETE /api/admin/children/:userId — permanently delete a child account.
// Most references cascade (parent_child_links, classroom_members, tribes +
// tribe_members, dragon_trial_results, user_dragons, game_scores,
// parent_claim_codes). The child-data tables that reference users without ON
// DELETE CASCADE (node_progress, problem_attempts, wrong_taps, user_companions,
// play_minutes, matches) are cleared explicitly, and any other kid's match that
// names this child as its PvP opponent has opponent_user_id nulled so it isn't
// orphaned. Irreversible — the admin UI gates it behind a danger-tone confirm.
router.delete('/children/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const [target] = await db
    .select({ id: schema.users.id, account_type: schema.users.accountType })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.account_type !== 'child') {
    return res.status(400).json({ error: 'This endpoint deletes child accounts only.' });
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.nodeProgress).where(eq(schema.nodeProgress.userId, userId));
    await tx.delete(schema.problemAttempts).where(eq(schema.problemAttempts.userId, userId));
    await tx.delete(schema.wrongTaps).where(eq(schema.wrongTaps.userId, userId));
    await tx.delete(schema.userCompanions).where(eq(schema.userCompanions.userId, userId));
    await tx.delete(schema.playMinutes).where(eq(schema.playMinutes.userId, userId));
    await tx.delete(schema.matches).where(eq(schema.matches.userId, userId));
    await tx.update(schema.matches)
      .set({ opponentUserId: null })
      .where(eq(schema.matches.opponentUserId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });

  res.json({ ok: true });
});

// GET /api/admin/analytics/:userId — aggregated stats for one child.
router.get('/analytics/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const days = parseInt(req.query.days, 10);
  const result = await buildAnalytics(userId, { days });
  if (!result) return res.status(404).json({ error: 'User not found' });
  res.json(result);
});

// PUT /api/admin/node-config/:nodeId — update one or more difficulty fields
// for a node.
router.put('/node-config/:nodeId', async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'Invalid nodeId' });
  }

  // Build the Drizzle update map (camelCase keys) alongside the raw values for
  // the cross-field range check below.
  const updates = {};
  const raw = {};
  const body = req.body || {};

  if (body.grid_size !== undefined) {
    const v = parseInt(body.grid_size, 10);
    if (!Number.isInteger(v) || v < MIN_GRID || v > MAX_GRID) {
      return res.status(400).json({ error: `grid_size must be an integer in [${MIN_GRID}, ${MAX_GRID}]` });
    }
    updates.gridSize = v; raw.grid_size = v;
  }

  if (body.ops !== undefined) {
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      return res.status(400).json({ error: 'ops must be a non-empty array' });
    }
    if (!body.ops.every(op => VALID_OPS.includes(op))) {
      return res.status(400).json({ error: `ops must contain only: ${VALID_OPS.join(', ')}` });
    }
    updates.ops = JSON.stringify(Array.from(new Set(body.ops)));
    raw.ops = updates.ops;
  }

  if (body.range_min !== undefined) {
    const v = parseInt(body.range_min, 10);
    if (!Number.isInteger(v) || v < 0 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_min must be an integer in [0, ${MAX_RANGE}]` });
    }
    updates.rangeMin = v; raw.range_min = v;
  }

  if (body.range_max !== undefined) {
    const v = parseInt(body.range_max, 10);
    if (!Number.isInteger(v) || v < 1 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_max must be an integer in [1, ${MAX_RANGE}]` });
    }
    updates.rangeMax = v; raw.range_max = v;
  }

  if (body.ai_seconds !== undefined) {
    const v = Number(body.ai_seconds);
    if (!Number.isFinite(v) || v < MIN_AI_SECONDS || v > MAX_AI_SECONDS) {
      return res.status(400).json({ error: `ai_seconds must be a number in [${MIN_AI_SECONDS}, ${MAX_AI_SECONDS}]` });
    }
    updates.aiSeconds = v; raw.ai_seconds = v;
  }

  if (body.shape_id !== undefined) {
    if (typeof body.shape_id !== 'string' || !VALID_SHAPE_IDS.has(body.shape_id)) {
      return res.status(400).json({ error: 'shape_id must be a known battle-grid shape' });
    }
    updates.shapeId = body.shape_id; raw.shape_id = body.shape_id;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  // Cross-field check: range_min must be <= range_max. Fetch current row to
  // validate against unchanged values when only one side is being updated.
  const [current] = await db
    .select({
      range_min: schema.nodeConfig.rangeMin,
      range_max: schema.nodeConfig.rangeMax,
    })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);

  if (!current) {
    return res.status(404).json({ error: `Unknown nodeId ${nodeId}` });
  }
  const nextMin = raw.range_min ?? current.range_min ?? 1;
  const nextMax = raw.range_max ?? current.range_max ?? 10;
  if (nextMin > nextMax) {
    return res.status(400).json({ error: 'range_min must be <= range_max' });
  }

  await db
    .update(schema.nodeConfig)
    .set(updates)
    .where(eq(schema.nodeConfig.nodeId, nodeId));

  const [row] = await db
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
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  res.json({ ...row, ops: JSON.parse(row.ops) });
});

// Larger body limit for the dragon-upload route only — a PNG arrives as a
// base64 data URL in JSON, and the global express.json() cap (100kb) is far too
// small for ~1MB art. Mounted per-route so the rest of the API stays tight.
const dragonUploadBody = express.json({ limit: '12mb' });

// Shape one catalog row for the admin client.
function dragonRowJson(r) {
  return {
    dragon_id: r.dragonId,
    name: r.name || '',
    rarity: r.rarity,
    retired: r.retired,
  };
}

// GET /api/admin/dragons — the full dragon catalog (one row per dragon),
// ordered by id. Each entry carries its name, rarity, and retired flag so the
// keeper can manage everything from one grid.
router.get('/dragons', async (req, res) => {
  const rows = await db
    .select()
    .from(schema.dragonCatalog)
    .orderBy(asc(schema.dragonCatalog.dragonId));
  res.json({ dragons: rows.map(dragonRowJson), count: rows.length });
});

// POST /api/admin/dragons { name, rarity, image } — add a brand-new dragon.
// `image` is a base64 PNG data URL ("data:image/png;base64,…"). We claim the
// next free id, write the art to public/ + dist/, and insert the catalog row.
router.post('/dragons', dragonUploadBody, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rarity = typeof req.body?.rarity === 'string' ? req.body.rarity : 'common';
  const image = typeof req.body?.image === 'string' ? req.body.image : '';

  if (!name || name.length > MAX_DRAGON_NAME_LEN) {
    return res.status(400).json({ error: `name is required (max ${MAX_DRAGON_NAME_LEN} chars)` });
  }
  if (!VALID_RARITIES.has(rarity)) {
    return res.status(400).json({ error: `rarity must be one of: ${[...VALID_RARITIES].join(', ')}` });
  }
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) {
    return res.status(400).json({ error: 'image must be a base64-encoded PNG data URL' });
  }
  const buffer = Buffer.from(m[1], 'base64');
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'image must be a non-empty PNG under 10MB' });
  }

  const dragonId = maxArtId() + 1;
  try {
    writeArt(dragonId, buffer);
  } catch (err) {
    return res.status(500).json({ error: `could not save dragon art: ${err.message}` });
  }

  const [row] = await db
    .insert(schema.dragonCatalog)
    .values({ dragonId, name, rarity })
    .onConflictDoUpdate({
      target: schema.dragonCatalog.dragonId,
      set: { name, rarity, retired: false },
    })
    .returning();

  res.status(201).json(dragonRowJson(row));
});

// PUT /api/admin/dragons/:dragonId { name?, rarity?, retired? } — edit a
// dragon. Any subset of fields may be sent; omitted fields are left untouched.
// Upserts so dragons earned before the catalog existed can still be classified.
router.put('/dragons/:dragonId', async (req, res) => {
  const dragonId = parseInt(req.params.dragonId, 10);
  if (!Number.isInteger(dragonId) || dragonId < 1) {
    return res.status(400).json({ error: 'dragonId must be a positive integer' });
  }

  const set = {};
  const insert = { dragonId };

  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > MAX_DRAGON_NAME_LEN) {
      return res.status(400).json({ error: `name must be 1–${MAX_DRAGON_NAME_LEN} chars` });
    }
    set.name = name;
    insert.name = name;
  }
  if (req.body?.rarity !== undefined) {
    if (!VALID_RARITIES.has(req.body.rarity)) {
      return res.status(400).json({ error: `rarity must be one of: ${[...VALID_RARITIES].join(', ')}` });
    }
    set.rarity = req.body.rarity;
    insert.rarity = req.body.rarity;
  }
  if (req.body?.retired !== undefined) {
    if (typeof req.body.retired !== 'boolean') {
      return res.status(400).json({ error: 'retired must be a boolean' });
    }
    set.retired = req.body.retired;
    insert.retired = req.body.retired;
  }
  if (Object.keys(set).length === 0) {
    return res.status(400).json({ error: 'nothing to update — send name, rarity, and/or retired' });
  }

  const [row] = await db
    .insert(schema.dragonCatalog)
    .values(insert)
    .onConflictDoUpdate({ target: schema.dragonCatalog.dragonId, set })
    .returning();

  res.json(dragonRowJson(row));
});

// DELETE /api/admin/dragons/:dragonId — soft-delete (retire) a dragon. It stops
// being handed out and drops from the catalog totals, but kids keep any copies
// they already caught. Restore by PUTting { retired: false }.
router.delete('/dragons/:dragonId', async (req, res) => {
  const dragonId = parseInt(req.params.dragonId, 10);
  if (!Number.isInteger(dragonId) || dragonId < 1) {
    return res.status(400).json({ error: 'dragonId must be a positive integer' });
  }

  const [row] = await db
    .insert(schema.dragonCatalog)
    .values({ dragonId, retired: true })
    .onConflictDoUpdate({
      target: schema.dragonCatalog.dragonId,
      set: { retired: true },
    })
    .returning();

  res.json(dragonRowJson(row));
});

// DELETE /api/admin/dragons/:dragonId/permanent — HARD delete, for copyright
// takedowns. Erases the art from disk, the catalog row, and every kid's
// collected copy. Irreversible; prefer the soft-delete above for normal
// "retire this dragon" cases.
router.delete('/dragons/:dragonId/permanent', async (req, res) => {
  const dragonId = parseInt(req.params.dragonId, 10);
  if (!Number.isInteger(dragonId) || dragonId < 1) {
    return res.status(400).json({ error: 'dragonId must be a positive integer' });
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.userDragons).where(eq(schema.userDragons.dragonId, dragonId));
    await tx.delete(schema.dragonCatalog).where(eq(schema.dragonCatalog.dragonId, dragonId));
  });
  removeArt(dragonId);

  res.json({ dragon_id: dragonId, deleted: true });
});

module.exports = router;
