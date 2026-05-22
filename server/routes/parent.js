const express = require('express');
const db = require('../db');
const { requireAuth, requireParent, requireOwnsChild } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { buildAnalytics } = require('../lib/analytics');

const router = express.Router();
router.use(requireAuth, requireParent);

// GET /api/parent/me — parent's own profile plus a count of linked kids.
router.get('/me', (req, res) => {
  const user = db.prepare(
    'SELECT id, email, email_verified, weekly_report_enabled FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Parent not found' });
  const { kids } = db.prepare(
    'SELECT COUNT(*) AS kids FROM parent_child_links WHERE parent_id = ?'
  ).get(req.user.id);
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
router.patch('/preferences', (req, res) => {
  const body = req.body || {};
  if (typeof body.weekly_report_enabled !== 'boolean') {
    return res.status(400).json({ error: 'weekly_report_enabled must be a boolean' });
  }
  db.prepare('UPDATE users SET weekly_report_enabled = ? WHERE id = ?')
    .run(body.weekly_report_enabled ? 1 : 0, req.user.id);
  res.json({ weekly_report_enabled: body.weekly_report_enabled });
});

// GET /api/parent/children — list linked kids with a few summary fields.
router.get('/children', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*) FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = date('now', 'localtime')) AS minutes_today,
           (SELECT COUNT(*) FROM play_minutes
              WHERE user_id = u.id
                AND minute >= datetime('now', 'localtime', '-7 days')) AS minutes_7d
    FROM parent_child_links pcl
    JOIN users u ON u.id = pcl.child_id
    WHERE pcl.parent_id = ?
    ORDER BY u.username COLLATE NOCASE
  `).all(req.user.id);
  res.json({ children: rows });
});

// POST /api/parent/children/link — { child_username, code } → link this parent
// to that child if the rotating claim code matches and hasn't expired.
router.post('/children/link', (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `link:${req.user.id}:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const childUsername = typeof req.body?.child_username === 'string' ? req.body.child_username.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  // Generic error so wrong-username and wrong-code are indistinguishable.
  const GENERIC = { error: "We couldn't find a child with that name and code." };
  if (!childUsername || !/^\d{6}$/.test(code)) return res.status(400).json(GENERIC);

  const child = db.prepare(
    "SELECT id, username, avatar, current_node_id FROM users WHERE username = ? AND account_type = 'child'"
  ).get(childUsername);
  if (!child) return res.status(400).json(GENERIC);

  const claim = db.prepare(
    'SELECT code, expires_at FROM parent_claim_codes WHERE child_id = ?'
  ).get(child.id);
  if (!claim) return res.status(400).json(GENERIC);
  if (claim.code !== code) return res.status(400).json(GENERIC);
  if (new Date(claim.expires_at).getTime() < Date.now()) return res.status(400).json(GENERIC);

  const linkAndConsume = db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO parent_child_links (parent_id, child_id) VALUES (?, ?)'
    ).run(req.user.id, child.id);
    db.prepare('DELETE FROM parent_claim_codes WHERE child_id = ?').run(child.id);
  });
  linkAndConsume();

  res.json({ child });
});

// DELETE /api/parent/children/:childId — unlink (does NOT delete the kid).
router.delete('/children/:childId', requireOwnsChild, (req, res) => {
  db.prepare('DELETE FROM parent_child_links WHERE parent_id = ? AND child_id = ?')
    .run(req.user.id, req.childId);
  res.json({ ok: true });
});

// POST /api/parent/children/:childId/reset-trial — clear the one-time Dragon's
// Trial flag so the child can retake the placement test. Does NOT roll back
// the previous trial's promotion (kid keeps any progress they earned).
router.post('/children/:childId/reset-trial', requireOwnsChild, (req, res) => {
  db.prepare(
    "UPDATE users SET dragon_trial_completed = 0 WHERE id = ? AND account_type = 'child'"
  ).run(req.childId);
  res.json({ ok: true });
});

// GET /api/parent/children/:childId/stats?days=7|30
router.get('/children/:childId/stats', requireOwnsChild, (req, res) => {
  const days = parseInt(req.query.days, 10);
  const result = buildAnalytics(req.childId, { days });
  if (!result) return res.status(404).json({ error: 'Child not found' });
  res.json(result);
});

module.exports = router;
