// The writes that record a kid's play — problem attempts and wrong taps,
// matches, node wins, collected dragons, active minutes, Proving Grounds medals,
// Dragon's Trial placements — shared by the web routes that record them one
// request at a time (attempts, matches, progress, dragons, playtime,
// proving-grounds, dragon-trial) and by the iOS sync upload (./syncEvents.js), which records
// the same things from a queue of offline events. One copy of each statement, so
// a row the app syncs is indistinguishable from one the browser posted.
//
// Every function takes the executor first — `db`, or the `tx` of a transaction
// the caller owns — and never opens a transaction of its own, so the sync
// upload can put an event's dedupe row and its effects in one transaction.
//
// The sync-only variants differ where arrival order matters. A queue can upload
// an older event after a newer one, so what they write does not depend on which
// came first: best stars and first completion win, a match's start and end can
// land in either order on one row, and a dragon's first-acquired time is the
// earliest one seen. The web routes keep their existing behaviour.
const { and, eq, isNull, ne, or, sql } = require('drizzle-orm');
const schema = require('../db/schema');

// ---------------------------------------------------------------- attempts

const ATTEMPT_OPS = new Set(['add', 'sub', 'mul', 'div']);
const ATTEMPT_OUTCOMES = new Set(['child', 'ai']);

const isInt = x => Number.isInteger(x);
const intOrNull = x => (Number.isFinite(x) ? Math.round(x) : null);

function isValidAttempt(a) {
  return !!a && isInt(a.node_id) && isInt(a.operand_a) && isInt(a.operand_b)
    && ATTEMPT_OPS.has(a.operator) && isInt(a.answer)
    && ATTEMPT_OUTCOMES.has(a.outcome);
}

function isValidWrongTap(w) {
  return !!w && isInt(w.node_id) && isInt(w.operand_a) && isInt(w.operand_b)
    && ATTEMPT_OPS.has(w.operator) && isInt(w.correct_answer) && isInt(w.tapped_value);
}

// `createdAt` is omitted by the web route (the column default, now()) and set by
// the sync upload to when the problem was actually answered, so an offline
// session lands in the right analytics window.
function attemptRow(userId, a, createdAt) {
  return {
    userId,
    nodeId: a.node_id,
    operandA: a.operand_a,
    operandB: a.operand_b,
    operator: a.operator,
    answer: a.answer,
    outcome: a.outcome,
    timeMs: intOrNull(a.time_ms),
    ...(createdAt ? { createdAt } : {}),
  };
}

function wrongTapRow(userId, w, createdAt) {
  return {
    userId,
    nodeId: w.node_id,
    operandA: w.operand_a,
    operandB: w.operand_b,
    operator: w.operator,
    correctAnswer: w.correct_answer,
    tappedValue: w.tapped_value,
    timeMs: intOrNull(w.time_ms),
    ...(createdAt ? { createdAt } : {}),
  };
}

async function insertAttempts(exec, attemptRows = [], wrongTapRows = []) {
  if (attemptRows.length) await exec.insert(schema.problemAttempts).values(attemptRows);
  if (wrongTapRows.length) await exec.insert(schema.wrongTaps).values(wrongTapRows);
}

// ---------------------------------------------------------------- matches

const MATCH_OUTCOMES = new Set(['child', 'ai', 'incomplete']);

// Web: open a match and hand back the server id the client ends it with.
async function createMatch(exec, { userId, nodeId }) {
  const [row] = await exec
    .insert(schema.matches)
    .values({ userId, nodeId })
    .returning({ id: schema.matches.id });
  return row.id;
}

// Web: finalize by server id. The first finalization wins, so a late
// "incomplete" beacon can't clobber a real win/loss.
// → 'not_found' | 'forbidden' | 'already_ended' | 'ended'
async function finalizeMatch(exec, { id, userId, outcome, playerScore, aiScore }) {
  const [row] = await exec
    .select({
      userId: schema.matches.userId,
      endedAt: schema.matches.endedAt,
    })
    .from(schema.matches)
    .where(eq(schema.matches.id, id))
    .limit(1);

  if (!row) return 'not_found';
  if (row.userId !== userId) return 'forbidden';
  if (row.endedAt) return 'already_ended';

  await exec
    .update(schema.matches)
    .set({ endedAt: sql`now()`, outcome, playerScore, aiScore })
    .where(eq(schema.matches.id, id));
  return 'ended';
}

// Sync: the device names a match by the UUID it minted offline, and its
// "started" and "ended" events may arrive in either order — so each one upserts
// the row on client_match_id. The start is authoritative for when the match
// began; an end that arrives first stands in with its own time until then.
//
// A client_match_id is only ever reused by the child who minted it; one that
// already belongs to someone else is refused rather than touched.
// → 'ok' | 'forbidden'
async function recordMatchStart(exec, { userId, clientMatchId, nodeId, startedAt }) {
  const rows = await exec
    .insert(schema.matches)
    .values({ userId, nodeId, clientMatchId, startedAt })
    .onConflictDoUpdate({
      target: schema.matches.clientMatchId,
      set: { startedAt: sql`excluded.started_at`, nodeId: sql`excluded.node_id` },
      setWhere: eq(schema.matches.userId, sql`excluded.user_id`),
    })
    .returning({ id: schema.matches.id });
  return rows.length ? 'ok' : 'forbidden';
}

// Sync: finalize by client_match_id. Same rule as the web path — a finished
// match keeps its result — with one refinement that only matters out of order:
// a real result replaces an 'incomplete' one, so an abandon beacon queued after
// the win but uploaded before it can't keep the win off the record.
// → 'ended' | 'kept' (already finished; nothing changed) | 'forbidden'
async function recordMatchEnd(exec, { userId, clientMatchId, nodeId, outcome, playerScore, aiScore, endedAt }) {
  const m = schema.matches;
  const rows = await exec
    .insert(m)
    .values({ userId, nodeId, clientMatchId, startedAt: endedAt, endedAt, outcome, playerScore, aiScore })
    .onConflictDoUpdate({
      target: m.clientMatchId,
      set: {
        endedAt: sql`excluded.ended_at`,
        outcome: sql`excluded.outcome`,
        playerScore: sql`excluded.player_score`,
        aiScore: sql`excluded.ai_score`,
      },
      setWhere: and(
        eq(m.userId, sql`excluded.user_id`),
        or(
          isNull(m.endedAt),
          and(eq(m.outcome, 'incomplete'), ne(sql`excluded.outcome`, 'incomplete')),
        ),
      ),
    })
    .returning({ id: m.id });
  if (rows.length) return 'ended';

  const [owner] = await exec
    .select({ userId: m.userId })
    .from(m)
    .where(eq(m.clientMatchId, clientMatchId))
    .limit(1);
  return owner?.userId === userId ? 'kept' : 'forbidden';
}

// ---------------------------------------------------------------- node progress

// Mark a node won and move the kid's frontier past it. The frontier only ever
// moves forward, so re-winning an earlier node leaves it alone.
//
// `keepBest` is the sync behaviour: the higher star count and the first
// completion time survive whichever order the wins arrive in. Without it (the
// web route) the latest win overwrites both, as it always has.
async function recordNodeWin(exec, { userId, nodeId, stars, completedAt = new Date(), keepBest = false }) {
  const np = schema.nodeProgress;
  const set = keepBest
    ? {
        completed: true,
        stars: sql`GREATEST(COALESCE(${np.stars}, 0), excluded.stars)`,
        completedAt: sql`LEAST(${np.completedAt}, excluded.completed_at)`,
      }
    : {
        completed: true,
        stars: sql`excluded.stars`,
        completedAt: sql`excluded.completed_at`,
      };

  await exec
    .insert(np)
    .values({ userId, nodeId, completed: true, stars, completedAt })
    .onConflictDoUpdate({ target: [np.userId, np.nodeId], set });

  await exec
    .update(schema.users)
    .set({ currentNodeId: sql`GREATEST(${schema.users.currentNodeId}, ${nodeId + 1})` })
    .where(eq(schema.users.id, userId));
}

// ---------------------------------------------------------------- dragons

// Every dragon that can currently be awarded — the catalog minus retired ones.
// dragon_catalog is the source of truth for which dragons exist (seeded for the
// original art, extended on upload), so this is read rather than hardcoded.
// Kept tiny and uncached: a few hundred rows, read infrequently.
async function activeCatalog(exec) {
  const { rows } = await exec.execute(sql`
    SELECT dragon_id, name, rarity
    FROM dragon_catalog
    WHERE NOT retired
    ORDER BY dragon_id
  `);
  return rows;
}

// Every dragon id in the catalog, retired or not. The sync upload checks
// against this rather than activeCatalog(): the device drew the dragon from the
// catalog it had at the time, and a dragon retired since then was still a
// legitimate prize — the kid saw it hatch, so it is not taken away (ADR 0004).
async function catalogDragonIds(exec) {
  const { rows } = await exec.execute(sql`SELECT dragon_id FROM dragon_catalog`);
  return new Set(rows.map(r => r.dragon_id));
}

// Add dragons to a kid's collection. `ids` may repeat ("caught the same dragon
// twice in one game"); each id bumps that dragon's count, inserting the row on
// first catch. First-acquired is the earliest time seen, so a catch synced late
// from an offline session still counts as the first if it was. `flagged` (an
// implausible sync upload — ./plausibility.js) adds the catches to the kid's
// count all the same, and to flagged_count, which shared views subtract.
// → [{ dragon_id, added, total, is_new }]
async function addDragons(exec, userId, ids, acquiredAt, { flagged = false } = {}) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);

  const ud = schema.userDragons;
  const results = [];
  for (const [dragonId, n] of counts) {
    const [row] = await exec
      .insert(ud)
      .values({
        userId, dragonId, count: n, flaggedCount: flagged ? n : 0,
        ...(acquiredAt ? { firstAcquiredAt: acquiredAt } : {}),
      })
      .onConflictDoUpdate({
        target: [ud.userId, ud.dragonId],
        set: {
          count: sql`${ud.count} + ${n}`,
          flaggedCount: sql`${ud.flaggedCount} + excluded.flagged_count`,
          firstAcquiredAt: sql`LEAST(${ud.firstAcquiredAt}, excluded.first_acquired_at)`,
        },
      })
      .returning({ count: ud.count });
    const total = row?.count ?? n;
    // First-ever catch ⇒ the row's count now equals this batch's n.
    results.push({ dragon_id: dragonId, added: n, total, is_new: total === n });
  }
  return results;
}

// ---------------------------------------------------------------- playtime

// Mark local minutes ('YYYY-MM-DD HH:MM', see ./localTime.js) as played. The
// (user, minute) primary key makes a repeat a no-op — except that an unflagged
// record of a minute clears a flag an implausible upload left on it (`flagged`,
// see ./plausibility.js), so a minute counts in shared stats if anything
// plausible says it was played, whichever arrived first.
async function recordPlayMinutes(exec, userId, minutes, { flagged = false } = {}) {
  if (!minutes.length) return;
  const pm = schema.playMinutes;
  await exec
    .insert(pm)
    .values(minutes.map(minute => ({ userId, minute, flagged })))
    .onConflictDoUpdate({
      target: [pm.userId, pm.minute],
      set: { flagged: false },
      setWhere: sql`${pm.flagged} AND NOT excluded.flagged`,
    });
}

// ---------------------------------------------------------------- proving grounds

// One medal-winning Proving Grounds run: one row per award, which is what a
// grown-up sees. Rows only add up, so arrival order doesn't matter — the best
// medal and best time per level are read back across them (routes/provingGrounds.js).
// `earnedAt` omitted = now (the web route); the sync upload passes the event's
// time. Returns { id, earned_at }.
async function recordProvingRun(exec, { userId, mode, digit, medal, elapsedMs, wrongCount, earnedAt }) {
  const values = { userId, mode, digit, medal, elapsedMs, wrongCount };
  if (earnedAt) values.earnedAt = earnedAt;
  const [row] = await exec
    .insert(schema.provingGroundsRuns)
    .values(values)
    .returning({ id: schema.provingGroundsRuns.id, earned_at: schema.provingGroundsRuns.earnedAt });
  return row;
}

// ---------------------------------------------------------------- dragon's trial

// The one-time placement test (docs/TRIAL.md). Per-op results as the client
// computed them; the server only checks their shape.
const TRIAL_OPS = Object.freeze(['add', 'sub', 'mul', 'div']);
const TRIAL_BANDS = Object.freeze(['fluent', 'capable', 'developing', 'emerging', 'not_ready']);
const TRIAL_SCORE_MAX = 1000;

// Highest fluent op among add → sub → mul (informational; persisted for parent
// stats). Placement drops the kid at the start of the first un-mastered op in
// that order, so this is the op just before it. Division has no world yet.
function trialHighestOp(perOp) {
  let highest = null;
  for (const op of ['add', 'sub', 'mul']) {
    if (perOp[op].band === 'fluent') highest = op;
  }
  return highest;
}

// Whether a node exists in the node config, so a placement can't point off the map.
async function nodeExists(exec, nodeId) {
  const rows = await exec
    .select({ nodeId: schema.nodeConfig.nodeId })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  return rows.length > 0;
}

// Record a finished trial: the kid's frontier moves to `targetNodeId`, every
// node before it counts as completed with 3 stars (existing stars are kept if
// better), users.dragon_trial_completed is set, and the dragon_trial_results
// summary row is written. `perOp` is { add: { score, band, asked }, … }.
//
// `keepFurthest` is the sync behaviour, where events can arrive in any order
// and after other play: the frontier only moves forward, a skipped node keeps
// its earliest completion, and a summary row is only replaced by a take at
// least as recent. Without it (the web route, which allows one take per reset)
// the frontier is set to the target and the summary replaced, as it always was.
async function recordTrialCompletion(exec, { userId, targetNodeId, perOp, takenAt = new Date(), keepFurthest = false }) {
  const u = schema.users;
  await exec
    .update(u)
    .set({
      currentNodeId: keepFurthest ? sql`GREATEST(${u.currentNodeId}, ${targetNodeId})` : targetNodeId,
      dragonTrialCompleted: true,
    })
    .where(eq(u.id, userId));

  const np = schema.nodeProgress;
  for (let n = 1; n < targetNodeId; n++) {
    await exec
      .insert(np)
      .values({ userId, nodeId: n, completed: true, stars: 3, completedAt: takenAt })
      .onConflictDoUpdate({
        target: [np.userId, np.nodeId],
        set: {
          completed: true,
          stars: sql`GREATEST(COALESCE(${np.stars}, 0), excluded.stars)`,
          completedAt: keepFurthest
            ? sql`LEAST(${np.completedAt}, excluded.completed_at)`
            : sql`COALESCE(${np.completedAt}, excluded.completed_at)`,
        },
      });
  }

  const r = schema.dragonTrialResults;
  await exec
    .insert(r)
    .values({
      userId,
      takenAt,
      targetNodeId,
      highestOp: trialHighestOp(perOp),
      addScore: perOp.add.score, addBand: perOp.add.band, addAsked: perOp.add.asked,
      subScore: perOp.sub.score, subBand: perOp.sub.band, subAsked: perOp.sub.asked,
      mulScore: perOp.mul.score, mulBand: perOp.mul.band, mulAsked: perOp.mul.asked,
      divScore: perOp.div.score, divBand: perOp.div.band, divAsked: perOp.div.asked,
    })
    .onConflictDoUpdate({
      target: r.userId,
      set: {
        takenAt: sql`excluded.taken_at`,
        targetNodeId: sql`excluded.target_node_id`,
        highestOp: sql`excluded.highest_op`,
        addScore: sql`excluded.add_score`, addBand: sql`excluded.add_band`, addAsked: sql`excluded.add_asked`,
        subScore: sql`excluded.sub_score`, subBand: sql`excluded.sub_band`, subAsked: sql`excluded.sub_asked`,
        mulScore: sql`excluded.mul_score`, mulBand: sql`excluded.mul_band`, mulAsked: sql`excluded.mul_asked`,
        divScore: sql`excluded.div_score`, divBand: sql`excluded.div_band`, divAsked: sql`excluded.div_asked`,
      },
      ...(keepFurthest ? { setWhere: sql`${r.takenAt} <= excluded.taken_at` } : {}),
    });
}

module.exports = {
  ATTEMPT_OPS,
  ATTEMPT_OUTCOMES,
  MATCH_OUTCOMES,
  isValidAttempt,
  isValidWrongTap,
  attemptRow,
  wrongTapRow,
  insertAttempts,
  createMatch,
  finalizeMatch,
  recordMatchStart,
  recordMatchEnd,
  recordNodeWin,
  activeCatalog,
  catalogDragonIds,
  addDragons,
  recordPlayMinutes,
  recordProvingRun,
  TRIAL_OPS,
  TRIAL_BANDS,
  TRIAL_SCORE_MAX,
  trialHighestOp,
  nodeExists,
  recordTrialCompletion,
};
