// The weekly digest must REPORT the week it NAMES.
//
// It didn't: the subject line, header and log row all carried the Monday–Sunday
// period from lastCompletedWeek(), while the numbers came from
// `buildAnalytics(child, { days: 7 })` — a rolling 7×24h window measured back
// from the send time. At the 13:00 Monday cron that silently dropped the reported
// Monday before 13:00 and counted the CURRENT Monday morning in its place, so a
// parent read one date range beside another week's numbers. 15 of these went to
// real inboxes before it was caught.
//
// weeklyReport.js is CommonJS and destructures its dependencies at require time,
// so vi.mock cannot reach them (see the Tests section of AGENTS.md). `Module._load`
// swaps ./analytics and ./email, and the exported db object's methods are replaced
// with recording fakes. Nothing here touches a database or sends mail.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

// --- fakes -----------------------------------------------------------------

// One thenable builder for every query shape weeklyReport uses: the parent scan
// ends at .where(), the duplicate check at .limit(), the child list at
// .orderBy(). Awaiting anywhere in the chain pops the next queued result, so the
// queue is just "the answers, in the order the function asks for them".
function makeFakeDb() {
  const state = { results: [], inserts: [] };
  const builder = {
    from() { return builder; },
    innerJoin() { return builder; },
    where() { return builder; },
    orderBy() { return builder; },
    limit() { return builder; },
    then(onOk, onErr) {
      return Promise.resolve(state.results.shift() ?? []).then(onOk, onErr);
    },
  };
  const db = {
    select() { return builder; },
    insert() {
      return {
        values(row) { state.inserts.push(row); return Promise.resolve(); },
      };
    },
  };
  return { db, state };
}

// --- harness ---------------------------------------------------------------

let runWeeklyReports;
let lastCompletedWeek;
let fake;
let analyticsCalls;   // every { userId, options } buildAnalytics was called with
let sentEmails;
let originalLoad;

beforeAll(() => {
  // db.js throws unless DATABASE_URL is set. pg's Pool is lazy and never
  // connects — every db method used is replaced below.
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.APP_PUBLIC_URL = 'https://example.test';

  originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './analytics') {
      return {
        buildAnalytics: (userId, options) => {
          analyticsCalls.push({ userId, options });
          // Shape the template reads; the values are irrelevant to this test.
          return Promise.resolve({
            user: { id: userId, username: 'kid', avatar: null },
            summary: { total: 4, child_wins: 3, avg_child_ms: 2500 },
            byOperator: [],
            playtime: { minutes_in_window: 12, by_day: [], minutes_today: null },
          });
        },
      };
    }
    if (request === './email') {
      return {
        sendEmail: (msg) => { sentEmails.push(msg); return Promise.resolve({ id: 'e1' }); },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  fake = makeFakeDb();
  const dbModule = require('../db.js');
  dbModule.db.select = fake.db.select;
  dbModule.db.insert = fake.db.insert;

  ({ runWeeklyReports, lastCompletedWeek } = require('./weeklyReport.js'));
});

afterAll(() => {
  if (originalLoad) Module._load = originalLoad;
});

beforeEach(() => {
  analyticsCalls = [];
  sentEmails = [];
  fake.state.inserts = [];
  fake.state.results = [
    [{ id: 1, email: 'parent@example.test' }],  // eligible parents
    [],                                          // no existing log row for this period
    [{ id: 77, username: 'kid', avatar: null }], // one child
  ];
});

describe('lastCompletedWeek', () => {
  it('returns the Monday–Sunday week before a Monday send', () => {
    // Local Monday 2026-08-03 13:00 — the real cron slot ('0 13 * * 1').
    const period = lastCompletedWeek(new Date(2026, 7, 3, 13, 0, 0));
    expect(period).toEqual({ period_start: '2026-07-27', period_end: '2026-08-02' });
  });

  it('is a full 7 days, Monday to Sunday', () => {
    const { period_start, period_end } = lastCompletedWeek(new Date(2026, 7, 3, 13, 0, 0));
    const start = new Date(`${period_start}T00:00:00Z`);
    const end = new Date(`${period_end}T00:00:00Z`);
    expect(start.getUTCDay()).toBe(1);                     // Monday
    expect(end.getUTCDay()).toBe(0);                       // Sunday
    expect((end - start) / 86400000).toBe(6);              // inclusive span of 7
  });

  it('never includes any part of the current week', () => {
    // Sunday is the trap: the "last completed week" on a Sunday is the week that
    // ended the PREVIOUS Sunday, not the one ending today.
    const sunday = new Date(2026, 7, 2, 13, 0, 0);
    const { period_end } = lastCompletedWeek(sunday);
    expect(period_end).toBe('2026-07-26');
    expect(period_end < '2026-08-02').toBe(true);
  });

  it('rolls back across a month boundary', () => {
    // Monday 2026-09-07 → the week before starts in August.
    expect(lastCompletedWeek(new Date(2026, 8, 7, 13, 0, 0)))
      .toEqual({ period_start: '2026-08-31', period_end: '2026-09-06' });
  });
});

describe('runWeeklyReports window', () => {
  it('asks buildAnalytics for the exact period it prints', async () => {
    const now = new Date(2026, 7, 3, 13, 0, 0);
    const period = lastCompletedWeek(now);

    await runWeeklyReports(now);

    expect(analyticsCalls).toHaveLength(1);
    const { options } = analyticsCalls[0];
    expect(options.range).toEqual({
      start_day: period.period_start,
      end_day: period.period_end,
    });
  });

  it('does not pass a rolling day count — that was the bug', async () => {
    // `days` and `range` are different windows and buildAnalytics lets `range`
    // win, but a digest that still passes `days` is one refactor away from
    // reverting to the rolling window.
    await runWeeklyReports(new Date(2026, 7, 3, 13, 0, 0));
    expect(analyticsCalls[0].options.days).toBeUndefined();
  });

  it('names the same period in the subject line, the email and the log row', async () => {
    const now = new Date(2026, 7, 3, 13, 0, 0);
    const period = lastCompletedWeek(now);

    await runWeeklyReports(now);

    // The three places a parent or an operator can see the claim, all from the
    // one period that was queried.
    expect(sentEmails[0].subject).toContain(period.period_start);
    expect(sentEmails[0].subject).toContain(period.period_end);
    expect(sentEmails[0].html).toContain(period.period_start);

    const logRow = fake.state.inserts.find(r => r.status === 'sent');
    expect(logRow.periodStart).toBe(period.period_start);
    expect(logRow.periodEnd).toBe(period.period_end);

    // The window actually queried, matched against the dates that were printed.
    expect(analyticsCalls[0].options.range.start_day).toBe(logRow.periodStart);
    expect(analyticsCalls[0].options.range.end_day).toBe(logRow.periodEnd);
  });
});
