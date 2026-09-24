const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const {
  buildDaySeries,
  buildDaySeriesBetween,
  toLocalIsoDay,
  localMinuteNow,
  localDayRange,
  localRangeForDays,
  localDayString,
  addLocalDays,
  localDayStart,
} = require('./localTime');
const { lastActivityAt } = require('./lastActivity');
const { childProgress } = require('./syncProgress');

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
// and the first_at/last_at bookends are deliberately left nullable: no attempts
// means no pace and no span, and 0 would read as "instant".
async function attemptSummary(userId, whereExtra) {
  const res = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END), 0)::int AS child_wins,
      COALESCE(SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END), 0)::int AS ai_wins,
      AVG(CASE WHEN outcome = 'child' THEN time_ms END)::float8 AS avg_child_ms,
      AVG(CASE WHEN outcome = 'ai'    THEN time_ms END)::float8 AS avg_ai_ms,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at
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
    // Bookends for the day, so the card can say when they practised rather than
    // only how much. Null on a quiet day.
    first_attempt_at: total ? summary.first_at ?? null : null,
    last_attempt_at: total ? summary.last_at ?? null : null,
    // A single flag so the UI never has to decide what "quiet" means.
    has_activity: total > 0 || minutes > 0,
  };
}

// Aggregated stats for one child. Used by /api/admin/analytics/:userId and the
// parent dashboard at /api/parent/children/:childId/stats.
// Two mutually exclusive kinds of window, and they are NOT interchangeable:
//
//   { days: N }                        rolling N×24h back from now(). Floats off
//                                      the calendar — this is what the parent
//                                      dashboard and admin drill-in want.
//   { range: { start_day, end_day } }  an exact INCLUSIVE span of local calendar
//                                      days. This is what anything that PRINTS
//                                      its own dates must use — the weekly digest
//                                      named a Mon–Sun period in the subject line
//                                      while asking for `days: 7`, so it dropped
//                                      the reported week's first morning and
//                                      counted the current Monday in its place.
//
// `range` wins if both are passed. Bounds are half-open [start, end) against real
// timestamp columns, and local-time text against play_minutes — localRangeForDays
// owns both, since those two frames of reference are the trap here.
async function buildAnalytics(userId, { days, range } = {}) {
  const user = await loadChild(userId);
  if (!user) return null;

  const hasRange = !!(range && range.start_day && range.end_day);
  const span = hasRange ? localRangeForDays(range.start_day, range.end_day) : null;
  // For "last N days" windows we compare against a Date cutoff computed in JS;
  // letting Postgres compute `now() - interval` works too but mixing them risks
  // timezone drift when the server moves regions. JS-side cutoff is portable.
  const hasWindow = !hasRange && Number.isInteger(days) && days > 0;
  const sinceDate = hasWindow ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  let sinceClause = sql``;
  let matchSinceCl = sql``;
  if (hasRange) {
    // Upper bound as well as lower — the whole point of a closed window. A
    // `>=`-only clause is what let "last week" include today.
    sinceClause  = sql`AND created_at >= ${span.start} AND created_at < ${span.end}`;
    matchSinceCl = sql`AND started_at >= ${span.start} AND started_at < ${span.end}`;
  } else if (hasWindow) {
    sinceClause  = sql`AND created_at >= ${sinceDate}`;
    matchSinceCl = sql`AND started_at >= ${sinceDate}`;
  }

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

  // play_minutes.minute is local-time TEXT, so both branches bound it with
  // 'YYYY-MM-DD HH:MM' strings — fixed-width, so lexical comparison is exact and
  // still uses the index.
  const playDays = hasRange ? span.days : (hasWindow ? Math.min(days, 90) : 30);
  let playBounds;
  if (hasRange) {
    playBounds = sql`AND minute >= ${span.startMinute} AND minute < ${span.endMinuteExclusive}`;
  } else {
    const playCutoff = new Date();
    playCutoff.setHours(0, 0, 0, 0);
    playCutoff.setDate(playCutoff.getDate() - (playDays - 1));
    playBounds = sql`AND minute >= ${localMinuteNow(playCutoff)}`;
  }
  const playRowsRes = await db.execute(sql`
    SELECT substr(minute, 1, 10) AS day, COUNT(*)::int AS minutes
    FROM play_minutes
    WHERE user_id = ${userId}
      ${playBounds}
    GROUP BY day
    ORDER BY day DESC
  `);
  const playRows = playRowsRes.rows;
  const playByDay = Object.fromEntries(playRows.map(r => [r.day, r.minutes]));
  const playMinutesByDay = hasRange
    ? buildDaySeriesBetween(range.start_day, range.end_day, playByDay)
    : buildDaySeries(playDays, playByDay);
  const todayKey = toLocalIsoDay(new Date());
  // Null rather than 0 when today falls outside the window: the digest reports a
  // week that ended on Sunday, and "0 minutes today" would be a claim it never
  // measured. Same rule as the nullable averages — no data is not a zero.
  const todayInWindow = !hasRange || (range.start_day <= todayKey && todayKey <= range.end_day);
  const minutesToday = todayInWindow ? (playByDay[todayKey] || 0) : null;
  const minutesWindow = playMinutesByDay.reduce((s, r) => s + r.minutes, 0);

  return {
    user,
    days: hasWindow ? days : null,
    // Echoed so a payload states which window produced it — a caller that prints
    // dates can assert they match what was actually queried.
    range: hasRange ? { start_day: range.start_day, end_day: range.end_day } : null,
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

// The iOS parent view's per-child card (GET /api/parent/children/:childId/summary):
// recent play, progress, dragons and which operation is strongest and weakest.
// Deliberately small — the web's full drill-in is buildAnalytics. Everything
// here is server-side play, so an iPad's offline games count once its queue has
// synced. Progress and dragons are exactly what GET /api/sync/progress reports
// (childProgress), so the parent sees the same totals the child's device pulls.
//
// Like the rest of the parent dashboard this is the family's own view, so flagged
// play is not excluded (docs/PLAUSIBILITY.md).
const MASTERY_WINDOW_DAYS = 30;
// Fewer answers than this in the window and an operation is listed but never
// called strongest or weakest — two lucky answers are not a strength.
const MASTERY_MIN_ATTEMPTS = 5;
const OPERATOR_ORDER = ['add', 'sub', 'mul', 'div'];

// Per-operation accuracy plus the strongest and weakest of those with enough
// answers: best accuracy first, then the faster average pace, then the fixed
// add/sub/mul/div order so a tie always names the same operation. `weakest` is
// null unless it is genuinely worse than `strongest` (one operation, or all
// equally accurate, has no weakest).
function operatorHighlights(rows, { minAttempts = MASTERY_MIN_ATTEMPTS } = {}) {
  const operators = rows.map(r => ({
    operator: r.operator,
    total: r.total,
    child_wins: r.child_wins || 0,
    accuracy: r.total ? (r.child_wins || 0) / r.total : 0,
    avg_child_ms: r.avg_child_ms ?? null,
  }));
  const pace = o => (o.avg_child_ms == null ? Infinity : o.avg_child_ms);
  const order = o => {
    const i = OPERATOR_ORDER.indexOf(o.operator);
    return i === -1 ? OPERATOR_ORDER.length : i;
  };
  const ranked = operators
    .filter(o => o.total >= minAttempts)
    .sort((a, b) => (b.accuracy - a.accuracy)
      || (pace(a) === pace(b) ? 0 : pace(a) < pace(b) ? -1 : 1)
      || (order(a) - order(b)));
  const strongest = ranked[0] || null;
  const last = ranked[ranked.length - 1] || null;
  const weakest = last && strongest && last.accuracy < strongest.accuracy ? last : null;
  return {
    operators,
    strongest: strongest ? strongest.operator : null,
    weakest: weakest ? weakest.operator : null,
  };
}

// `now` is injectable so the day and week boundaries can be tested.
async function buildChildSummary(userId, { now = new Date() } = {}) {
  const user = await loadChild(userId);
  if (!user) return null;

  // "This week" is today and the six days before it, as local calendar days —
  // the same span GET /api/parent/children calls minutes_7d.
  const today = localDayString(now);
  const weekStartMinute = localMinuteNow(localDayStart(addLocalDays(today, -6)));
  const masterySince = new Date(now.getTime() - MASTERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [progress, byOperator, minutesRes, lastRes] = await Promise.all([
    childProgress(db, userId),
    attemptsByOperator(userId, sql`AND created_at >= ${masterySince}`),
    db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE substr(minute, 1, 10) = ${today})::int AS today,
             COUNT(*)::int AS week
      FROM play_minutes
      WHERE user_id = ${userId} AND minute >= ${weekStartMinute}
    `),
    db.execute(sql`SELECT ${lastActivityAt(userId)} AS at`),
  ]);
  const minutes = minutesRes.rows[0] || {};
  const lastAt = lastRes.rows[0]?.at ?? null;

  return {
    child_id: user.id,
    play: {
      minutes_today: minutes.today || 0,
      minutes_7d: minutes.week || 0,
      minutes_total: progress.play_minutes,
      last_played_at: lastAt ? new Date(lastAt).toISOString() : null,
    },
    progress: {
      current_node_id: progress.current_node_id,
      nodes_won: progress.nodes.length,
      stars: progress.nodes.reduce((sum, n) => sum + n.stars, 0),
      three_star_nodes: progress.nodes.filter(n => n.stars >= 3).length,
    },
    dragons: {
      kinds: progress.dragons.length,
      total: progress.dragons.reduce((sum, d) => sum + d.count, 0),
    },
    mastery: {
      window_days: MASTERY_WINDOW_DAYS,
      min_attempts: MASTERY_MIN_ATTEMPTS,
      ...operatorHighlights(byOperator),
    },
  };
}

module.exports = {
  buildAnalytics,
  buildDailySummary,
  buildChildSummary,
  operatorHighlights,
  MASTERY_WINDOW_DAYS,
  MASTERY_MIN_ATTEMPTS,
};
