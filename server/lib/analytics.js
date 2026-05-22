const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { buildDaySeries, toLocalIsoDay, localMinuteNow } = require('../routes/playtime');

// Aggregated stats for one child. Used by /api/admin/analytics/:userId and the
// parent dashboard at /api/parent/children/:childId/stats.
async function buildAnalytics(userId, { days } = {}) {
  const [user] = await db
    .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;

  // For "last N days" windows we compare against a Date cutoff computed in JS;
  // letting Postgres compute `now() - interval` works too but mixing them risks
  // timezone drift when the server moves regions. JS-side cutoff is portable.
  const hasWindow = Number.isInteger(days) && days > 0;
  const sinceDate = hasWindow ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  const sinceClause   = hasWindow ? sql`AND created_at >= ${sinceDate}`  : sql``;
  const matchSinceCl  = hasWindow ? sql`AND started_at >= ${sinceDate}`  : sql``;

  const summaryRes = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END)::int AS child_wins,
      SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END)::int AS ai_wins,
      AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms,
      AVG(CASE WHEN outcome = 'ai'    THEN time_ms END)::float8 AS avg_ai_ms
    FROM problem_attempts
    WHERE user_id = ${userId} ${sinceClause}
  `);
  const summary = summaryRes.rows[0];

  const byOperatorRes = await db.execute(sql`
    SELECT operator,
           COUNT(*)::int AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END)::int AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END)::int AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ${userId} ${sinceClause}
    GROUP BY operator
    ORDER BY operator
  `);
  const byOperator = byOperatorRes.rows;

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

module.exports = { buildAnalytics };
