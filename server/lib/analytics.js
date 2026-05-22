const db = require('../db');
const { buildDaySeries, toLocalIsoDay } = require('../routes/playtime');

// Aggregated stats for one child. Used by /api/admin/analytics/:userId and the
// parent dashboard at /api/parent/children/:childId/stats.
function buildAnalytics(userId, { days } = {}) {
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const sinceClause = Number.isInteger(days) && days > 0
    ? `AND created_at >= datetime('now', '-${days} days')`
    : '';

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
      SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
      AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms,
      AVG(CASE WHEN outcome = 'ai'    THEN time_ms END)  AS avg_ai_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
  `).get(userId);

  const byOperator = db.prepare(`
    SELECT operator,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator
    ORDER BY operator
  `).all(userId);

  const byNode = db.prepare(`
    SELECT node_id,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY node_id
    ORDER BY node_id
  `).all(userId);

  const hardProblems = db.prepare(`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING total >= 2
    ORDER BY ai_wins DESC, avg_child_ms DESC NULLS LAST, total DESC
    LIMIT 25
  `).all(userId);

  const fastestProblems = db.prepare(`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*) AS child_wins,
           AVG(time_ms) AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? AND outcome = 'child' ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING child_wins >= 2
    ORDER BY avg_child_ms ASC
    LIMIT 15
  `).all(userId);

  const confusions = db.prepare(`
    SELECT operator, operand_a, operand_b, correct_answer, tapped_value,
           COUNT(*) AS n
    FROM wrong_taps
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator, operand_a, operand_b, correct_answer, tapped_value
    ORDER BY n DESC
    LIMIT 20
  `).all(userId);

  const recentAttempts = db.prepare(`
    SELECT node_id, operand_a, operand_b, operator, answer, outcome, time_ms, created_at
    FROM problem_attempts
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(userId);

  const matchSinceClause = Number.isInteger(days) && days > 0
    ? `AND started_at >= datetime('now', '-${days} days')`
    : '';

  const matchSummary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END) AS child_wins,
      SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END) AS ai_wins,
      SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END) AS incomplete
    FROM matches
    WHERE user_id = ? ${matchSinceClause}
  `).get(userId);

  const byNodeMatches = db.prepare(`
    SELECT node_id,
           COUNT(*) AS matches,
           SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END) AS ai_wins,
           SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END) AS incomplete,
           AVG(player_score) AS avg_player_score,
           AVG(ai_score)     AS avg_ai_score
    FROM matches
    WHERE user_id = ? ${matchSinceClause}
    GROUP BY node_id
    ORDER BY node_id
  `).all(userId);

  const playDays = Number.isInteger(days) && days > 0 ? Math.min(days, 90) : 30;
  const playRows = db.prepare(`
    SELECT substr(minute, 1, 10) AS day, COUNT(*) AS minutes
    FROM play_minutes
    WHERE user_id = ?
      AND minute >= datetime('now', 'localtime', ?)
    GROUP BY day
    ORDER BY day DESC
  `).all(userId, `-${playDays - 1} days`);
  const playByDay = Object.fromEntries(playRows.map(r => [r.day, r.minutes]));
  const playMinutesByDay = buildDaySeries(playDays, playByDay);
  const todayKey = toLocalIsoDay(new Date());
  const minutesToday = playByDay[todayKey] || 0;
  const minutesWindow = playMinutesByDay.reduce((s, r) => s + r.minutes, 0);

  return {
    user,
    days: Number.isInteger(days) && days > 0 ? days : null,
    summary,
    byOperator,
    byNode,
    hardProblems,
    fastestProblems,
    confusions,
    recentAttempts,
    matches: matchSummary,
    byNodeMatches,
    playtime: {
      window_days: playDays,
      minutes_today: minutesToday,
      minutes_in_window: minutesWindow,
      by_day: playMinutesByDay,
    },
  };
}

module.exports = { buildAnalytics };
