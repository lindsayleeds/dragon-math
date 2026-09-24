// Plausibility checks on results the server did not see happen (ADR 0004,
// docs/PLAUSIBILITY.md). The iOS app decides wins and prizes on the device, so a
// modified device could award itself anything. The server's answer is to FLAG,
// never to reject or take back: a flagged result is applied exactly as an
// unflagged one — the kid's collection, map and own stats keep it — and is only
// left out of what other people see: leaderboards, class/tribe rankings, and
// teacher and school stats.
//
// Three layers here:
//   - thresholds (PLAUSIBILITY) and reason codes (REASONS) — named, in one place;
//   - pure checks (clockReasons, matchReasons, …) that turn numbers into
//     reasons, testable with no database;
//   - db helpers that read the rate windows from sync_events and record a flag.
// The exclusion itself is SQL in the routes that build shared views, through
// countedDragonSql / countedMinuteSql below, so every one of them agrees on what
// "counted" means.
//
// Checks are deliberately generous: a false positive costs a real kid their
// place on a leaderboard, and a determined cheat can always pace themselves under
// any rate. These catch the blatant — a ten-problem battle in two seconds, a
// hundred dragons in a minute, a device clock a week out.
const { sql } = require('drizzle-orm');
const schema = require('../db/schema');
const { BATTLE_SETTINGS } = require('./ruleSettings');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PLAUSIBILITY = Object.freeze({
  // Match floor: the fastest a kid can read a problem and tap its answer. The
  // opponent's floor comes from rule settings (battle.opponent.min_delay_ms), as
  // do the blank beats between problems (battle.timings) — see minMatchDurationMs.
  MIN_CHILD_SOLVE_MS: 250,
  // The floor is multiplied by this before comparing, for timer and clock jitter
  // between two events stamped on one device.
  MATCH_FLOOR_TOLERANCE: 0.9,

  // Clock: occurred_at this far after the upload is a clock set ahead (the event
  // is already recorded at "now" — see syncEvents.js); this far before it is a
  // clock set back, or a queue far older than any real offline stretch.
  CLOCK_AHEAD_TOLERANCE_MS: 10 * MINUTE_MS,
  MAX_EVENT_AGE_MS: 90 * DAY_MS,

  // Reward rates, judged over RATE_WINDOW_MS either side of the event.
  RATE_WINDOW_MS: HOUR_MS,
  // The Egg Hatchery hands out 12 in one game — the most any game awards at once
  // (a post-game prize is 1–3). More than that in one event is a burst.
  MAX_DRAGONS_PER_EVENT: 12,
  // Ten back-to-back hatchery games an hour.
  MAX_DRAGONS_PER_WINDOW: 120,
  // A win takes a full battle (first to 10) plus the map and prize screens;
  // one a minute for an hour is already beyond any kid.
  MAX_NODE_WINS_PER_WINDOW: 60,

  // Dragon Munchers is finite: the campaign is 8 levels (4 easy bases, 4 hard),
  // each clearing at most 12 correct answers at 5 or 10 points —
  // 4·12·5 + 4·12·10 = 720, and a single-base game is at most 12·10 = 120.
  // plausibility.test.js recomputes this from src/rules/munchers.js and the
  // default Munchers rule settings.
  MUNCHERS_MAX_SCORE: 720,
});

// Stable codes stored in plausibility_flags.reasons. Never rename one.
const REASONS = Object.freeze({
  MATCH_TOO_FAST: 'match_too_fast',
  MATCH_ENDS_BEFORE_START: 'match_ends_before_start',
  CLOCK_AHEAD: 'clock_ahead',
  CLOCK_BEHIND: 'clock_behind',
  DRAGON_BURST: 'dragon_burst',
  DRAGON_RATE: 'dragon_rate',
  NODE_WIN_RATE: 'node_win_rate',
  SCORE_ABOVE_MAX: 'score_above_max',
});

// ---------------------------------------------------------------- pure checks

// Reasons an event's device timestamp is implausible, against when it arrived.
function clockReasons(occurredAtMs, nowMs) {
  if (occurredAtMs > nowMs + PLAUSIBILITY.CLOCK_AHEAD_TOLERANCE_MS) return [REASONS.CLOCK_AHEAD];
  if (occurredAtMs < nowMs - PLAUSIBILITY.MAX_EVENT_AGE_MS) return [REASONS.CLOCK_BEHIND];
  return [];
}

// The shortest a battle with these scores can physically take. Every problem
// needs a solve — the kid's at MIN_CHILD_SOLVE_MS, the opponent's never under
// min_delay_ms — and every problem but the last is followed by its blank beat
// (grid_blank_ms after the kid's, grid_blank_ai_ms after the opponent's). Which
// problem was last is unknown, so the longest beat present is the one left out.
// Wrong-tap locks and bond powers only ever make a battle longer.
function minMatchDurationMs({ playerScore, aiScore }, battle = BATTLE_SETTINGS) {
  const { opponent, timings } = battle;
  const solves = playerScore * PLAUSIBILITY.MIN_CHILD_SOLVE_MS + aiScore * opponent.min_delay_ms;
  let beats = playerScore * timings.grid_blank_ms + aiScore * timings.grid_blank_ai_ms;
  if (aiScore > 0) beats -= timings.grid_blank_ai_ms;
  else if (playerScore > 0) beats -= timings.grid_blank_ms;
  return solves + beats;
}

// Reasons a finished match (both ends known) is implausible.
function matchReasons({ startedAt, endedAt, playerScore, aiScore }, battle = BATTLE_SETTINGS) {
  const duration = endedAt.getTime() - startedAt.getTime();
  if (duration < 0) return [REASONS.MATCH_ENDS_BEFORE_START];
  const floor = minMatchDurationMs({ playerScore, aiScore }, battle) * PLAUSIBILITY.MATCH_FLOOR_TOLERANCE;
  return duration < floor ? [REASONS.MATCH_TOO_FAST] : [];
}

// `window` is { before, after }: the total in the RATE_WINDOW_MS ending at the
// event and in the one starting at it, the event itself included in both.
// Looking both ways is what makes the verdict independent of upload order —
// whichever of two close events arrives second sees the other.
function overRate(window, max) {
  return window.before > max || window.after > max;
}

function dragonReasons(dragonCount, window) {
  const reasons = [];
  if (dragonCount > PLAUSIBILITY.MAX_DRAGONS_PER_EVENT) reasons.push(REASONS.DRAGON_BURST);
  if (overRate(window, PLAUSIBILITY.MAX_DRAGONS_PER_WINDOW)) reasons.push(REASONS.DRAGON_RATE);
  return reasons;
}

function nodeWinReasons(window) {
  return overRate(window, PLAUSIBILITY.MAX_NODE_WINS_PER_WINDOW) ? [REASONS.NODE_WIN_RATE] : [];
}

// Leaderboard scores posted by the web routes.
const MAX_SCORES = Object.freeze({ 'dragon-munchers': PLAUSIBILITY.MUNCHERS_MAX_SCORE });

function gameScoreReasons(game, score) {
  const max = MAX_SCORES[game];
  return max !== undefined && score > max ? [REASONS.SCORE_ABOVE_MAX] : [];
}

// ---------------------------------------------------------------- db helpers

// Sum `amount` (a SQL expression over sync_events) for one child's applied
// events of `kind` in the windows either side of `at` (the device's own
// occurred_at, as sync_events stores it).
async function rateWindow(exec, { userId, kind, at, amount }) {
  const W = PLAUSIBILITY.RATE_WINDOW_MS;
  const from = new Date(at.getTime() - W);
  const to = new Date(at.getTime() + W);
  const { rows } = await exec.execute(sql`
    SELECT
      COALESCE(SUM(${amount}) FILTER (WHERE occurred_at <= ${at}), 0)::int AS before,
      COALESCE(SUM(${amount}) FILTER (WHERE occurred_at >= ${at}), 0)::int AS after
    FROM sync_events
    WHERE user_id = ${userId} AND kind = ${kind} AND applied
      AND occurred_at > ${from} AND occurred_at < ${to}
  `);
  return rows[0];
}

const dragonWindow = (exec, userId, at) => rateWindow(exec, {
  userId, kind: 'dragons_collected', at, amount: sql`jsonb_array_length(payload->'dragon_ids')`,
});
const nodeWinWindow = (exec, userId, at) => rateWindow(exec, { userId, kind: 'node_won', at, amount: sql`1` });

// A synced match with both ends in: the row, and whether its start has really
// arrived (an end that lands first stands in for the start with its own time,
// which must not read as a zero-length match). → row | null
async function syncedMatchForCheck(exec, { userId, clientMatchId }) {
  const { rows } = await exec.execute(sql`
    SELECT m.started_at, m.ended_at, m.player_score, m.ai_score,
           EXISTS (
             SELECT 1 FROM sync_events se
             WHERE se.user_id = m.user_id AND se.kind = 'match_started' AND se.applied
               AND lower(se.payload->>'match_id') = lower(${clientMatchId})
           ) AS has_start
    FROM matches m
    WHERE m.client_match_id = ${clientMatchId} AND m.user_id = ${userId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || !row.ended_at || !row.has_start) return null;
  return {
    startedAt: new Date(row.started_at),
    endedAt: new Date(row.ended_at),
    playerScore: row.player_score,
    aiScore: row.ai_score,
  };
}

// Record (or add reasons to) the flag for one subject. No-op without reasons.
async function recordFlag(exec, { userId, subject, subjectRef, syncEventId = null, reasons, details = null }) {
  if (!reasons.length) return;
  const pf = schema.plausibilityFlags;
  await exec
    .insert(pf)
    .values({ userId, subject, subjectRef: String(subjectRef).toLowerCase(), syncEventId, reasons, details })
    .onConflictDoUpdate({
      target: [pf.subject, pf.subjectRef],
      set: {
        reasons: sql`ARRAY(SELECT DISTINCT r FROM unnest(${pf.reasons} || excluded.reasons) AS r ORDER BY r)`,
        details: sql`COALESCE(${pf.details}, '{}'::jsonb) || COALESCE(excluded.details, '{}'::jsonb)`,
      },
    });
}

// ---------------------------------------------------------------- exclusion

// Whether a user_dragons row counts in a shared view: at least one of its
// catches was not flagged. `alias` is the table alias in the caller's query.
const countedDragonSql = (alias = 'ud') => sql.raw(`${alias}.count > ${alias}.flagged_count`);
// The number of a dragon that counts in a shared view.
const countedDragonCountSql = (alias = 'ud') => sql.raw(`(${alias}.count - ${alias}.flagged_count)`);
// Whether a play_minutes row counts in teacher/school stats.
const countedMinuteSql = (alias = 'pm') => sql.raw(`NOT ${alias}.flagged`);

module.exports = {
  PLAUSIBILITY,
  REASONS,
  clockReasons,
  minMatchDurationMs,
  matchReasons,
  dragonReasons,
  nodeWinReasons,
  gameScoreReasons,
  dragonWindow,
  nodeWinWindow,
  syncedMatchForCheck,
  recordFlag,
  countedDragonSql,
  countedDragonCountSql,
  countedMinuteSql,
};
