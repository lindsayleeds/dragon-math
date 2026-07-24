const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { buildDaySeries, toLocalIsoDay, localMinuteNow, localDayRange } = require('./localTime');

// The child identity every stats payload leads with. Returns null when the id
// doesn't exist so callers can answer 404.
async function loadChild(userId) {
  const [user] = await db
    .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user || null;
}

// `outcome` is 'child' (solved it) or 'ai' (the dragon got there first), so
// child_wins/total is what the app calls accuracy. Both the windowed and the
// single-day views count it the same way — `whereExtra` is the only difference.
//
// The win counts are COALESCEd because SUM() over an empty window returns NULL,
// which would otherwise pair a `total: 0` with `child_wins: null`. The averages
// are deliberately left nullable: no attempts means no pace, and 0 would read
// as "instant".
async function attemptSummary(userId, whereExtra) {
  const res = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END), 0)::int AS child_wins,
      COALESCE(SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END), 0)::int AS ai_wins,
      AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms,
      AVG(CASE WHEN outcome = 'ai'    THEN time_ms END)::float8 AS avg_ai_ms
    FROM problem_attempts
    WHERE user_id = ${userId} ${whereExtra}
  `);
  return res.rows[0];
}

async function attemptsByOperator(userId, whereExtra) {
  const res = await db.execute(sql`
    SELECT operator,
           COUNT(*)::int AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END)::int AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END)::int AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ${userId} ${whereExtra}
    GROUP BY operator
    ORDER BY operator
  `);
  return res.rows;
}

// Minutes of play recorded on one local calendar day. play_minutes.minute is
// local-time 'YYYY-MM-DD HH:MM' text, so the day key is a prefix match.
async function minutesOnDay(userId, day) {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS minutes
    FROM play_minutes
    WHERE user_id = ${userId}
      AND substr(minute, 1, 10) = ${day}
  `);
  return res.rows[0]?.minutes || 0;
}

// One child's practice on a single local calendar day — the parent's "today"
// card. Deliberately not `buildAnalytics(id, { days: 1 })`: that window is a
// rolling 24 hours, which neither starts at midnight nor rolls over cleanly.
// `now` is injectable so the day boundary can be exercised without waiting.
async function buildDailySummary(userId, { now = new Date() } = {}) {
  const user = await loadChild(userId);
  if (!user) return null;

  const { day, start, end } = localDayRange(now);
  const dayClause = sql`AND created_at >= ${start} AND created_at < ${end}`;

  const [summary, byOperator, minutes] = await Promise.all([
    attemptSummary(userId, dayClause),
    attemptsByOperator(userId, dayClause),
    minutesOnDay(userId, day),
  ]);

  // Bookends for the day, so the card can say when they practised rather than
  // only how much. Null on a quiet day.
  const spanRes = await db.execute(sql`
    SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at
    FROM problem_attempts
    WHERE user_id = ${userId} ${dayClause}
  `);
  const span = spanRes.rows[0] || {};

  const total = summary?.total || 0;
  return {
    user,
    day,
    // The zone `day` was computed in, so the client can render the day's clock
    // times in the same frame of reference instead of the browser's.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    summary,
    byOperator,
    minutes,
    first_attempt_at: total ? span.first_at : null,
    last_attempt_at: total ? span.last_at : null,
    // A single flag so the UI never has to decide what "quiet" means.
    has_activity: total > 0 || minutes > 0,
  };
}

// Aggregated stats for one child. Used by /api/admin/analytics/:userId and the
// parent dashboard at /api/parent/children/:childId/stats.
async function buildAnalytics(userId, { days } = {}) {
  const user = await loadChild(userId);
  if (!user) return null;

  // For "last N days" windows we compare against a Date cutoff computed in JS;
  // letting Postgres compute `now() - interval` works too but mixing them risks
  // timezone drift when the server moves regions. JS-side cutoff is portable.
  const hasWindow = Number.isInteger(days) && days > 0;
  const sinceDate = hasWindow ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  const sinceClause   = hasWindow ? sql`AND created_at >= ${sinceDate}`  : sql``;
  const matchSinceCl  = hasWindow ? sql`AND started_at >= ${sinceDate}`  : sql``;

  const summary = await attemptSummary(userId, sinceClause);
  const byOperator = await attemptsByOperator(userId, sinceClause);

  const byNodeRes = await db.execute(sql`
    SELECT node_id,
           COUNT(*)::int AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END)::int AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END)::int AS ai_wins
    FROM problem_attempts
    WHERE user_id = ${userId} ${sinceClause}
    GROUP BY node_id
    ORDER BY node_id
  `);
  const byNode = byNodeRes.rows;

  const hardProblemsRes = await db.execute(sql`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*)::int AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END)::int AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END)::int AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ${userId} ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING COUNT(*) >= 2
    ORDER BY ai_wins DESC, avg_child_ms DESC NULLS LAST, total DESC
    LIMIT 25
  `);
  const hardProblems = hardProblemsRes.rows;

  const fastestProblemsRes = await db.execute(sql`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*)::int AS child_wins,
           AVG(time_ms)::float8 AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ${userId} AND outcome = 'child' ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING COUNT(*) >= 2
    ORDER BY avg_child_ms ASC
    LIMIT 15
  `);
  const fastestProblems = fastestProblemsRes.rows;

  const confusionsRes = await db.execute(sql`
    SELECT operator, operand_a, operand_b, correct_answer, tapped_value,
           COUNT(*)::int AS n
    FROM wrong_taps
    WHERE user_id = ${userId} ${sinceClause}
    GROUP BY operator, operand_a, operand_b, correct_answer, tapped_value
    ORDER BY n DESC
    LIMIT 20
  `);
  const confusions = confusionsRes.rows;

  const recentAttemptsRes = await db.execute(sql`
    SELECT node_id, operand_a, operand_b, operator, answer, outcome, time_ms, created_at
    FROM problem_attempts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `);
  const recentAttempts = recentAttemptsRes.rows;

  const matchSummaryRes = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END)::int AS child_wins,
      SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END)::int AS ai_wins,
      SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END)::int AS incomplete
    FROM matches
    WHERE user_id = ${userId} ${matchSinceCl}
  `);
  const matchSummary = matchSummaryRes.rows[0];

  const byNodeMatchesRes = await db.execute(sql`
    SELECT node_id,
           COUNT(*)::int AS matches,
           SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END)::int AS child_wins,
           SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END)::int AS ai_wins,
           SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END)::int AS incomplete,
           AVG(player_score)::float8 AS avg_player_score,
           AVG(ai_score)::float8     AS avg_ai_score
    FROM matches
    WHERE user_id = ${userId} ${matchSinceCl}
    GROUP BY node_id
    ORDER BY node_id
  `);
  const byNodeMatches = byNodeMatchesRes.rows;

  const [trialRow] = await db
    .select({
      taken_at: schema.dragonTrialResults.takenAt,
      target_node_id: schema.dragonTrialResults.targetNodeId,
      highest_op: schema.dragonTrialResults.highestOp,
      add_score: schema.dragonTrialResults.addScore,
      add_band:  schema.dragonTrialResults.addBand,
      add_asked: schema.dragonTrialResults.addAsked,
      sub_score: schema.dragonTrialResults.subScore,
      sub_band:  schema.dragonTrialResults.subBand,
      sub_asked: schema.dragonTrialResults.subAsked,
      mul_score: schema.dragonTrialResults.mulScore,
      mul_band:  schema.dragonTrialResults.mulBand,
      mul_asked: schema.dragonTrialResults.mulAsked,
      div_score: schema.dragonTrialResults.divScore,
      div_band:  schema.dragonTrialResults.divBand,
      div_asked: schema.dragonTrialResults.divAsked,
    })
    .from(schema.dragonTrialResults)
    .where(eq(schema.dragonTrialResults.userId, userId))
    .limit(1);
  const trial = trialRow ? {
    taken_at: trialRow.taken_at,
    target_node_id: trialRow.target_node_id,
    highest_op: trialRow.highest_op,
    per_op: {
      add: { score: trialRow.add_score, band: trialRow.add_band, asked: trialRow.add_asked },
      sub: { score: trialRow.sub_score, band: trialRow.sub_band, asked: trialRow.sub_asked },
      mul: { score: trialRow.mul_score, band: trialRow.mul_band, asked: trialRow.mul_asked },
      div: { score: trialRow.div_score, band: trialRow.div_band, asked: trialRow.div_asked },
    },
  } : null;

  const playDays = hasWindow ? Math.min(days, 90) : 30;
  const playCutoff = new Date();
  playCutoff.setHours(0, 0, 0, 0);
  playCutoff.setDate(playCutoff.getDate() - (playDays - 1));
  const playCutoffStr = localMinuteNow(playCutoff);
  const playRowsRes = await db.execute(sql`
    SELECT substr(minute, 1, 10) AS day, COUNT(*)::int AS minutes
    FROM play_minutes
    WHERE user_id = ${userId}
      AND minute >= ${playCutoffStr}
    GROUP BY day
    ORDER BY day DESC
  `);
  const playRows = playRowsRes.rows;
  const playByDay = Object.fromEntries(playRows.map(r => [r.day, r.minutes]));
  const playMinutesByDay = buildDaySeries(playDays, playByDay);
  const todayKey = toLocalIsoDay(new Date());
  const minutesToday = playByDay[todayKey] || 0;
  const minutesWindow = playMinutesByDay.reduce((s, r) => s + r.minutes, 0);

  return {
    user,
    days: hasWindow ? days : null,
    summary,
    byOperator,
    byNode,
    hardProblems,
    fastestProblems,
    confusions,
    recentAttempts,
    matches: matchSummary,
    byNodeMatches,
    trial,
    playtime: {
      window_days: playDays,
      minutes_today: minutesToday,
      minutes_in_window: minutesWindow,
      by_day: playMinutesByDay,
    },
  };
}

module.exports = { buildAnalytics, buildDailySummary };
