// Local-clock helpers shared by playtime, analytics, admin and parent views.
//
// play_minutes.minute is stored as the server's local-time 'YYYY-MM-DD HH:MM'
// text. Postgres has no `localtime` modifier, so every comparison string is
// computed here in JS (in the server's timezone) and passed as a parameter.
//
// Deliberately dependency-free — no db, no express — so the date arithmetic
// can be exercised on its own (see scripts/check-local-time.cjs).

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

function toLocalIsoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The calendar day containing `d` in the server's local timezone, as both the
// 'YYYY-MM-DD' key used by play_minutes and the half-open [start, end) Date
// range used against real timestamp columns (problem_attempts.created_at etc.).
// This is the single definition of "today" for day-scoped views — `days: N`
// windows elsewhere are rolling N×24h and deliberately do NOT line up with it.
function localDayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { day: localDayString(start), start, end };
}

// Build a continuous day series so the UI doesn't have to fill gaps.
function buildDaySeries(days, byDay, today = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = toLocalIsoDay(d);
    out.push({ day: key, minutes: byDay[key] || 0 });
  }
  return out;
}

module.exports = {
  localMinuteNow,
  localDayString,
  localDayRange,
  toLocalIsoDay,
  buildDaySeries,
};
