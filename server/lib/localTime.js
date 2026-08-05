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

// Local midnight of a 'YYYY-MM-DD' day string.
//
// Parsed by parts on purpose: `new Date('2026-07-27')` is defined to parse as
// UTC, so on any negative-offset server it lands on the 26th at 20:00 local and
// every range built from it is a day out. `new Date(y, m-1, d)` is local.
function localDayStart(dayStr) {
  const [y, m, d] = String(dayStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// `dayStr` shifted by n calendar days, as a 'YYYY-MM-DD' string. Goes through a
// Date so month/year rollover and DST-length days are the platform's problem.
function addLocalDays(dayStr, n) {
  const d = localDayStart(dayStr);
  d.setDate(d.getDate() + n);
  return toLocalIsoDay(d);
}

// An explicit, INCLUSIVE span of calendar days (startDay..endDay) expressed in
// both frames of reference the schema uses:
//
//   start/end                      half-open [start, end) local Dates, for real
//                                  timestamptz columns (problem_attempts.created_at,
//                                  matches.started_at)
//   startMinute/endMinuteExclusive 'YYYY-MM-DD HH:MM' text bounds for
//                                  play_minutes.minute, which is local-time text
//
// This is what a *calendar* window needs and what `days: N` cannot give: N×24h
// measured back from now() floats off the day boundary, so a report that prints
// "Mon–Sun" while querying `days: 7` states one span and counts another. See
// buildAnalytics.
//
// `days` is derived by rounding, not dividing exactly: a span crossing a DST
// transition is 6.96 or 7.04 real days long, and the answer wanted is 7.
function localRangeForDays(startDay, endDay) {
  const start = localDayStart(startDay);
  const endExclusiveDay = addLocalDays(endDay, 1);
  const end = localDayStart(endExclusiveDay);
  return {
    start,
    end,
    days: Math.round((end - start) / 86400000),
    startMinute: `${startDay} 00:00`,
    // Built from the day string rather than formatting `end`, because in a zone
    // that springs forward AT midnight there is no 00:00 on that date and the
    // Date normalises to 01:00 — which would silently drop that hour.
    endMinuteExclusive: `${endExclusiveDay} 00:00`,
  };
}

// A continuous day series across an explicit inclusive span. The `buildDaySeries`
// below is anchored to today and counts backwards, which cannot express a window
// that ended in the past (last week's digest).
function buildDaySeriesBetween(startDay, endDay, byDay) {
  // Counted, not walked-until-past-the-end. Advancing a cursor and comparing it
  // to endDay reads fine but makes termination depend on addLocalDays always
  // moving forward — and when that assumption broke under a negative-offset
  // timezone, the loop consumed memory until node died instead of failing a
  // check. Deriving the length up front cannot not-terminate, and a reversed
  // span is simply zero days.
  const { days } = localRangeForDays(startDay, endDay);
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = addLocalDays(startDay, i);
    out.push({ day, minutes: byDay[day] || 0 });
  }
  return out;
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
  localDayStart,
  addLocalDays,
  localRangeForDays,
  toLocalIsoDay,
  buildDaySeries,
  buildDaySeriesBetween,
};
