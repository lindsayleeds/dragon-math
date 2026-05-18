const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const insertMinute = db.prepare(`
  INSERT OR IGNORE INTO play_minutes (user_id, minute)
  VALUES (?, strftime('%Y-%m-%d %H:%M', 'now', 'localtime'))
`);
const todayCount = db.prepare(`
  SELECT COUNT(*) AS minutes
  FROM play_minutes
  WHERE user_id = ?
    AND substr(minute, 1, 10) = date('now', 'localtime')
`);
const dailySeries = db.prepare(`
  SELECT substr(minute, 1, 10) AS day, COUNT(*) AS minutes
  FROM play_minutes
  WHERE user_id = ?
    AND minute >= datetime('now', 'localtime', ?)
  GROUP BY day
  ORDER BY day DESC
`);

// POST /api/playtime/heartbeat — record that the signed-in user was active
// during the current local minute. Safe to call repeatedly; the unique PK
// makes repeats no-ops.
router.post('/heartbeat', (req, res) => {
  const userId = req.user.id;
  insertMinute.run(userId);
  const { minutes } = todayCount.get(userId);
  res.json({ ok: true, today_minutes: minutes });
});

// GET /api/playtime/me?days=N — caller's own daily minutes for the last N
// local days (default 7, max 90). Includes today even if zero.
router.get('/me', (req, res) => {
  const userId = req.user.id;
  let days = parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1) days = 7;
  if (days > 90) days = 90;

  const rows = dailySeries.all(userId, `-${days - 1} days`);
  const byDay = Object.fromEntries(rows.map(r => [r.day, r.minutes]));
  const series = buildDaySeries(days, byDay);
  const today = series[series.length - 1]?.minutes ?? 0;

  res.json({ days, today_minutes: today, series });
});

// Build a continuous day series so the UI doesn't have to fill gaps.
function buildDaySeries(days, byDay) {
  const today = new Date();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = toLocalIsoDay(d);
    out.push({ day: key, minutes: byDay[key] || 0 });
  }
  return out;
}

function toLocalIsoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = router;
module.exports.buildDaySeries = buildDaySeries;
module.exports.toLocalIsoDay = toLocalIsoDay;
