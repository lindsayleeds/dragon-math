const express = require('express');
const { and, eq, gte, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// play_minutes.minute is stored as the server's local-time 'YYYY-MM-DD HH:MM'.
// We compute the local strings in JS (the server's TZ) and pass them as
// parameters — Postgres has no `localtime` modifier so this stays where the
// SQLite version had it.

function localMinuteNow(d = new Date()) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}
function localDayString(d = new Date()) {
  return localMinuteNow(d).slice(0, 10);
}

// POST /api/playtime/heartbeat — record that the signed-in user was active
// during the current local minute. Safe to call repeatedly; the unique PK
// makes repeats no-ops.
router.post('/heartbeat', async (req, res) => {
  const userId = req.user.id;
  const minute = localMinuteNow();
  const today  = localDayString();

  await db
    .insert(schema.playMinutes)
    .values({ userId, minute })
    .onConflictDoNothing();

  const [{ minutes }] = await db
    .select({ minutes: sql`COUNT(*)::int`.as('minutes') })
    .from(schema.playMinutes)
    .where(and(
      eq(schema.playMinutes.userId, userId),
      sql`substr(${schema.playMinutes.minute}, 1, 10) = ${today}`,
    ));

  res.json({ ok: true, today_minutes: minutes });
});

// GET /api/playtime/me?days=N — caller's own daily minutes for the last N
// local days (default 7, max 90). Includes today even if zero.
router.get('/me', async (req, res) => {
  const userId = req.user.id;
  let days = parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1) days = 7;
  if (days > 90) days = 90;

  // Cutoff = midnight local time, (days-1) days ago. minute >= cutoff captures
  // the last N local days inclusive of today.
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = localMinuteNow(cutoff);

  const rows = await db
    .select({
      day: sql`substr(${schema.playMinutes.minute}, 1, 10)`.as('day'),
      minutes: sql`COUNT(*)::int`.as('minutes'),
    })
    .from(schema.playMinutes)
    .where(and(
      eq(schema.playMinutes.userId, userId),
      gte(schema.playMinutes.minute, cutoffStr),
    ))
    .groupBy(sql`day`)
    .orderBy(sql`day DESC`);

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
module.exports.localMinuteNow = localMinuteNow;
module.exports.localDayString = localDayString;
