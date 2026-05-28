const express = require('express');
const crypto = require('crypto');
const { and, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent, requireOwnsChild } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { buildAnalytics } = require('../lib/analytics');
const { localMinuteNow, localDayString } = require('./playtime');

const router = express.Router();
router.use(requireAuth, requireParent);

// GET /api/parent/me — parent's own profile plus a count of linked kids.
router.get('/me', async (req, res) => {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      email_verified: schema.users.emailVerified,
      weekly_report_enabled: schema.users.weeklyReportEnabled,
    })
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Parent not found' });

  const [{ kids }] = await db
    .select({ kids: sql`COUNT(*)::int`.as('kids') })
    .from(schema.parentChildLinks)
    .where(eq(schema.parentChildLinks.parentId, req.user.id));

  res.json({
    user: {
      id: user.id,
      email: user.email,
      email_verified: !!user.email_verified,
      weekly_report_enabled: !!user.weekly_report_enabled,
      account_type: 'parent',
    },
    kid_count: kids,
  });
});

// PATCH /api/parent/preferences — toggle weekly digest opt-in.
router.patch('/preferences', async (req, res) => {
  const body = req.body || {};
  if (typeof body.weekly_report_enabled !== 'boolean') {
    return res.status(400).json({ error: 'weekly_report_enabled must be a boolean' });
  }
  await db
    .update(schema.users)
    .set({ weeklyReportEnabled: body.weekly_report_enabled })
    .where(eq(schema.users.id, req.user.id));
  res.json({ weekly_report_enabled: body.weekly_report_enabled });
});

// GET /api/parent/children — list linked kids with a few summary fields.
router.get('/children', async (req, res) => {
  const todayStr  = localDayString();
  const cutoff7d  = new Date();
  cutoff7d.setHours(0, 0, 0, 0);
  cutoff7d.setDate(cutoff7d.getDate() - 6);
  const cutoff7dStr = localMinuteNow(cutoff7d);

  // Single query with correlated subqueries — same shape as the SQLite version.
  // Username is citext so ORDER BY username is already case-insensitive.
  const rows = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           u.needs_handle, u.login_token,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*)::int FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = ${todayStr}) AS minutes_today,
           (SELECT COUNT(*)::int FROM play_minutes
              WHERE user_id = u.id
                AND minute >= ${cutoff7dStr}) AS minutes_7d
    FROM parent_child_links pcl
    JOIN users u ON u.id = pcl.child_id
    WHERE pcl.parent_id = ${req.user.id}
    ORDER BY u.username
  `);
  res.json({ children: rows.rows });
});

// POST /api/parent/children — create a brand-new child account already linked
// to this parent. The child has no password and no handle yet; they sign in by
// visiting /k/<login_token> (delivered as a QR code) and pick their own handle.
router.post('/children', async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `create-child:${req.user.id}:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many new adventurers. Try again later.' });

  const loginToken = crypto.randomUUID();
  // The username column is NOT NULL UNIQUE; seed it with the (36-char) login
  // token as a guaranteed-unique placeholder. A kid handle can be at most 24
  // chars, so this placeholder can never collide with a real chosen handle.
  // It is replaced the moment the child picks their handle.
  const child = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.users)
      .values({
        username: loginToken,
        accountType: 'child',
        loginToken,
        needsHandle: true,
      })
      .returning({
        id: schema.users.id,
        avatar: schema.users.avatar,
        current_node_id: schema.users.currentNodeId,
      });
    await tx
      .insert(schema.parentChildLinks)
      .values({ parentId: req.user.id, childId: inserted.id })
      .onConflictDoNothing();
    return inserted;
  });

  res.status(201).json({
    child: {
      id: child.id,
      username: null,
      avatar: child.avatar,
      current_node_id: child.current_node_id,
      needs_handle: true,
      login_token: loginToken,
    },
  });
});

// POST /api/parent/children/link — { child_username, code } → link this parent
// to that child if the rotating claim code matches and hasn't expired.
router.post('/children/link', async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `link:${req.user.id}:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const childUsername = typeof req.body?.child_username === 'string' ? req.body.child_username.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  // Generic error so wrong-username and wrong-code are indistinguishable.
  const GENERIC = { error: "We couldn't find a child with that name and code." };
  if (!childUsername || !/^\d{6}$/.test(code)) return res.status(400).json(GENERIC);

  const [child] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      current_node_id: schema.users.currentNodeId,
    })
    .from(schema.users)
    .where(and(
      eq(schema.users.username, childUsername),
      eq(schema.users.accountType, 'child'),
    ))
    .limit(1);
  if (!child) return res.status(400).json(GENERIC);

  const [claim] = await db
    .select({ code: schema.parentClaimCodes.code, expires_at: schema.parentClaimCodes.expiresAt })
    .from(schema.parentClaimCodes)
    .where(eq(schema.parentClaimCodes.childId, child.id))
    .limit(1);
  if (!claim) return res.status(400).json(GENERIC);
  if (claim.code !== code) return res.status(400).json(GENERIC);
  if (new Date(claim.expires_at).getTime() < Date.now()) return res.status(400).json(GENERIC);

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.parentChildLinks)
      .values({ parentId: req.user.id, childId: child.id })
      .onConflictDoNothing();
    await tx
      .delete(schema.parentClaimCodes)
      .where(eq(schema.parentClaimCodes.childId, child.id));
  });

  res.json({ child });
});

// DELETE /api/parent/children/:childId — unlink (does NOT delete the kid).
router.delete('/children/:childId', requireOwnsChild, async (req, res) => {
  await db
    .delete(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, req.user.id),
      eq(schema.parentChildLinks.childId, req.childId),
    ));
  res.json({ ok: true });
});

// POST /api/parent/children/:childId/reset-trial — clear the one-time Dragon's
// Trial flag so the child can retake the placement test. Does NOT roll back
// the previous trial's promotion (kid keeps any progress they earned).
router.post('/children/:childId/reset-trial', requireOwnsChild, async (req, res) => {
  await db
    .update(schema.users)
    .set({ dragonTrialCompleted: false })
    .where(and(
      eq(schema.users.id, req.childId),
      eq(schema.users.accountType, 'child'),
    ));
  res.json({ ok: true });
});

// GET /api/parent/children/:childId/stats?days=7|30
router.get('/children/:childId/stats', requireOwnsChild, async (req, res) => {
  const days = parseInt(req.query.days, 10);
  const result = await buildAnalytics(req.childId, { days });
  if (!result) return res.status(404).json({ error: 'Child not found' });
  res.json(result);
});

module.exports = router;
