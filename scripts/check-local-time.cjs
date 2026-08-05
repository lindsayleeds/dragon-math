#!/usr/bin/env node
// Assertions for server/lib/localTime.js — the day-boundary maths behind the
// parent "today" view and every play_minutes query.
//
// The repo has no test framework, so this is a plain `node scripts/check-local-time.cjs`
// with a non-zero exit on failure. It needs no database and no .env, which is
// the whole reason those helpers live in a dependency-free module.
//
// Run it with TZ set to somewhere far from your own to catch UTC assumptions:
//   TZ=Pacific/Auckland node scripts/check-local-time.cjs

const {
  localMinuteNow,
  localDayString,
  localDayRange,
  localDayStart,
  addLocalDays,
  localRangeForDays,
  toLocalIsoDay,
  buildDaySeries,
  buildDaySeriesBetween,
} = require('../server/lib/localTime');

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}

// --- formatting -------------------------------------------------------------
const noon = new Date(2026, 6, 24, 12, 30, 5); // 24 Jul 2026, 12:30 local
check('localMinuteNow zero-pads to YYYY-MM-DD HH:MM',
  localMinuteNow(noon) === '2026-07-24 12:30', localMinuteNow(noon));
check('single-digit month/day/hour/minute all pad',
  localMinuteNow(new Date(2026, 0, 3, 4, 5)) === '2026-01-03 04:05',
  localMinuteNow(new Date(2026, 0, 3, 4, 5)));
check('localDayString is the date half of localMinuteNow',
  localDayString(noon) === '2026-07-24', localDayString(noon));
check('toLocalIsoDay agrees with localDayString',
  toLocalIsoDay(noon) === localDayString(noon));

// --- day range --------------------------------------------------------------
const r = localDayRange(noon);
check('range starts at local midnight',
  r.start.getHours() === 0 && r.start.getMinutes() === 0
  && r.start.getSeconds() === 0 && r.start.getMilliseconds() === 0);
check('range ends at the next local midnight',
  r.end.getDate() === 25 && r.end.getHours() === 0);
check('range key matches the play_minutes day key',
  r.day === localDayString(noon), r.day);
check('the moment itself falls inside its own range',
  noon >= r.start && noon < r.end);

// --- rollover ---------------------------------------------------------------
const lastSecond = new Date(2026, 6, 24, 23, 59, 59);
const firstSecond = new Date(2026, 6, 25, 0, 0, 0);
const a = localDayRange(lastSecond);
const b = localDayRange(firstSecond);
check('23:59:59 still belongs to the 24th', a.day === '2026-07-24', a.day);
check('00:00:00 belongs to the 25th', b.day === '2026-07-25', b.day);
check('consecutive ranges are adjacent', a.end.getTime() === b.start.getTime());
check('ranges are half-open: 23:59:59 is not in the next day',
  !(lastSecond >= b.start && lastSecond < b.end));
check('ranges are half-open: midnight is not in the previous day',
  !(firstSecond >= a.start && firstSecond < a.end));

// A rolling 24h window is NOT the same as "today" — this is why the daily
// summary can't just call buildAnalytics with days: 1.
const rolling24hAgo = new Date(noon.getTime() - 24 * 3600 * 1000);
check('a rolling 24h window reaches back into yesterday',
  rolling24hAgo < r.start);

// --- month / year / DST edges ----------------------------------------------
const monthEnd = localDayRange(new Date(2026, 6, 31, 9, 0));
check('month end rolls into the next month',
  monthEnd.end.getMonth() === 7 && monthEnd.end.getDate() === 1,
  monthEnd.end.toString());
const yearEnd = localDayRange(new Date(2026, 11, 31, 9, 0));
check('year end rolls into the next year',
  yearEnd.end.getFullYear() === 2027 && yearEnd.end.getMonth() === 0
  && yearEnd.end.getDate() === 1, yearEnd.end.toString());
const leap = localDayRange(new Date(2028, 1, 28, 9, 0));
check('leap year keeps Feb 29', leap.end.getDate() === 29, leap.end.toString());

// Across a DST change the day is still one calendar day, even though it is not
// 24 hours long — setDate/setHours handle this where arithmetic on ms would not.
for (const d of [new Date(2026, 2, 8, 12, 0), new Date(2026, 10, 1, 12, 0)]) {
  const dst = localDayRange(d);
  const nextDay = new Date(dst.start);
  nextDay.setDate(nextDay.getDate() + 1);
  check(`DST day ${dst.day} ends exactly one calendar day later`,
    dst.end.getTime() === nextDay.getTime());
  check(`DST day ${dst.day} still starts at local midnight`,
    dst.start.getHours() === 0);
}

// --- day series -------------------------------------------------------------
const series = buildDaySeries(7, { '2026-07-24': 12 }, noon);
check('series has one entry per requested day', series.length === 7, series.length);
check('series ends on the anchor day',
  series[series.length - 1].day === '2026-07-24', series[series.length - 1].day);
check('series starts 6 days earlier',
  series[0].day === '2026-07-18', series[0].day);
check('known day carries its minutes',
  series[series.length - 1].minutes === 12);
check('gaps are filled with zero, not undefined',
  series.slice(0, 6).every(x => x.minutes === 0));

// --- explicit calendar ranges ----------------------------------------------
// These back the weekly digest, which PRINTS its own date range — so a range that
// is a day out is a visible lie to a parent, not just a skewed number. Run under
// a negative-offset zone (TZ=America/New_York) to catch the UTC-parsing trap:
// `new Date('2026-07-27')` is UTC midnight, which is the 26th at 20:00 local.
check('localDayStart is local midnight, not UTC midnight',
  localDayStart('2026-07-27').getHours() === 0
  && localDayStart('2026-07-27').getDate() === 27,
  localDayStart('2026-07-27').toString());

check('addLocalDays crosses a month boundary',
  addLocalDays('2026-07-31', 1) === '2026-08-01', addLocalDays('2026-07-31', 1));
check('addLocalDays goes backwards too',
  addLocalDays('2026-08-01', -1) === '2026-07-31', addLocalDays('2026-08-01', -1));
check('addLocalDays crosses a year boundary',
  addLocalDays('2026-12-31', 1) === '2027-01-01', addLocalDays('2026-12-31', 1));

// The exact window the digest asks for: Mon 2026-07-27 .. Sun 2026-08-02.
const week = localRangeForDays('2026-07-27', '2026-08-02');
check('range spans 7 inclusive days', week.days === 7, week.days);
check('range starts at local midnight of the first day',
  week.start.getDate() === 27 && week.start.getHours() === 0, week.start.toString());
check('range end is EXCLUSIVE — local midnight of the day after the last',
  week.end.getDate() === 3 && week.end.getHours() === 0, week.end.toString());
check('play_minutes lower bound is the first day at 00:00',
  week.startMinute === '2026-07-27 00:00', week.startMinute);
check('play_minutes upper bound is the day AFTER the last, exclusive',
  week.endMinuteExclusive === '2026-08-03 00:00', week.endMinuteExclusive);
// The bug this fixes: a rolling `days: 7` window measured from a Monday 13:00
// send time reaches into the current week. A calendar range must not.
check('range cannot reach into the following day',
  week.endMinuteExclusive <= '2026-08-03 00:00');

const oneDay = localRangeForDays('2026-07-27', '2026-07-27');
check('a single-day range is 1 day, not 0', oneDay.days === 1, oneDay.days);

// A week containing a DST transition is 6.96 or 7.04 real days; it is still 7
// calendar days, which is what the email claims.
for (const [s, e] of [['2026-03-02', '2026-03-08'], ['2026-10-26', '2026-11-01']]) {
  const dst = localRangeForDays(s, e);
  check(`DST week ${s}..${e} is still 7 days`, dst.days === 7, dst.days);
}

const between = buildDaySeriesBetween('2026-07-27', '2026-08-02', { '2026-07-29': 9 });
check('series between covers every day in the span', between.length === 7, between.length);
// Indexed with at()/optional chaining so a wrong length reports every remaining
// check instead of throwing on the first out-of-bounds read.
check('series between starts on the first day',
  between.at(0)?.day === '2026-07-27', between.at(0)?.day);
check('series between ends on the last day',
  between.at(-1)?.day === '2026-08-02', between.at(-1)?.day);
check('series between carries known minutes',
  between.find(d => d.day === '2026-07-29')?.minutes === 9);
check('series between zero-fills quiet days',
  between.filter(d => d.minutes === 0).length === 6);
check('a reversed span yields nothing rather than looping forever',
  buildDaySeriesBetween('2026-08-02', '2026-07-27', {}).length === 0);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`localTime: all checks passed (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
