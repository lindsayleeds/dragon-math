// The battle rules as a pure, clock-driven reducer: every timer, the grid lock,
// the opponent's pace, first to PROBLEMS_TO_WIN, and the companion Bond Powers.
//
// src/hooks/useBattle.js is a thin React wrapper around this: it turns taps,
// the server config and its own single setTimeout into events, and performs the
// side effects this returns (sounds, attempt logging). The Swift battle is a
// port of this file, and golden/battle-transcripts.json (built in
// src/rules/battleTranscripts.js) is the check that the port matches it.
//
//   createBattleState({ config, layout, target?, settings?, pace? }, rng) → state
//   stepBattle(state, event, rng)                    → { state, effects }
//   nextTimerAt(state)                               → ms | null
//   isBondActive(state)                              → boolean
//
// Nothing here reads a clock or Math.random: time arrives as `event.now` (ms,
// any epoch — only differences matter) and randomness from the `rng` argument
// (`() => number` in [0, 1), e.g. createSeededRandom(seed).next). stepBattle
// never mutates its input and returns the SAME state object when an event
// changes nothing, so a caller can skip a re-render.
//
// ─── State (plain data only — no functions, Maps or class instances) ────────
//
//   config        { ops: string[], range: [min, max], aiSeconds, shapeId? }
//   layout        { cols, rows, cells: boolean[] }   row-major, true = numbered
//   target        points to win (PROBLEMS_TO_WIN)
//   settings      the game-wide tunables (src/data/battleSettings.js):
//                 { aiJitterFraction, aiMinDelayMs, gridBlankMs, gridBlankAiMs,
//                   gridLockMs, wrongFlashMs }
//   pace          'normal' | 'slow' | 'off'  the child's game pace (a parent
//                 setting, src/rules/pace.js); fixed for the battle
//   problem       { a, b, op, text, answer }         from generateProblem
//   grid          (number | null)[]                  parallel to layout.cells
//   round         deal counter; +1 whenever a new problem is dealt
//   playerScore, aiScore
//   status        'playing' | 'won' | 'lost'
//   wrongCellIndex        cell flashing as a wrong tap, or null
//   gridLocked            true while the think-it-through pause runs
//   blanking              true between a solve and the next problem
//   aiSolvedAnswer        answer the opponent just took, or null
//   aiEatCellIndex        cell the opponent is gobbling, or null
//   hintCellIndices       hint2x2 cells, or null
//   hintColor             highlight colour for hint2x2 / revealAnswer, or null
//   revealCellIndex       revealAnswer cell, or null
//   mushroomCellIndices   cells covered by mushroomGrove, or null
//   zappedCellIndices     cells removed by lightningStrike, or null
//   aiLocked              aiLockout running
//   shieldActive          petalShield armed
//   bondCooldownMs        remaining cooldown, counted down in 100 ms steps
//   bondCooldownTotalMs   the cooldown it started from (for the ring)
//   matchStartedAt        ms of `start`/`retry`, null before `start`
//   problemStartedAt      ms the current problem was dealt, null before `start`
//   matchDurationMs       set once the match is won or lost, else null
//   timers                { id, kind, at }[]  pending deadlines (see below)
//   nextTimerId           id for the next timer
//
// ─── Timers ──────────────────────────────────────────────────────────────────
//
// Every delay the battle has is an entry in `timers`, fired in (at, id) order —
// the order JavaScript's own timers run in. A timer fires AT its `at`, not at
// the event's `now`, so a late tick replays exactly what on-time ticks would
// have (a repeating timer catches up one step at a time). Kinds:
//
//   opponentSolve    the opponent answers the current problem
//   nextProblem      the blank ends: deal the next problem, unlock the grid
//   unlockGrid       the wrong-tap pause ends
//   clearWrongFlash  the wrong-tap flash ends (one per wrong tap)
//   clearHint        hint2x2 ends
//   clearReveal      revealAnswer ends
//   endAiLockout     aiLockout ends
//   cooldownTick     bondCooldownMs -= 100; repeats (same id) until it is 0
//
// Some timers deliberately outlive a retry (nextProblem, clearWrongFlash,
// clearHint, clearReveal, endAiLockout), as the setTimeouts they replace did.
//
// The opponent runs while the match is started, playing, not blanking, not
// aiLocked and the pace is not 'off'. Whenever it (re)starts — a new problem, a
// changed aiSeconds, the end of a blank or of a lockout — it gets a FRESH
// delay, drawn with one rng() call:
// max(aiMinDelayMs, base + base * aiJitterFraction * (rng() - 0.5)),
// base = aiSeconds * 1000 * paceFactor(pace), evaluated in exactly that order,
// with the settings in force at that moment. It never resumes a partial delay.
// Untimed ('off'), it never starts, so it never draws.
//
// ─── Events (each carries `now`) ─────────────────────────────────────────────
//
//   { type: 'start', now }                    start the clocks and the opponent
//   { type: 'tick', now }                     fire every timer due by `now`
//   { type: 'tap', now, cell }                the child taps grid index `cell`
//   { type: 'bondPower', now, power }         power: { kind, cooldownMs,
//                                               durationMs?, highlightColor? }
//   { type: 'settingsLoaded', now, settings }  served tunables; later timers
//                                               use them, running ones keep theirs
//   { type: 'configLoaded', now, config, layout }  server node config: redeal
//   { type: 'retry', now }                    a fresh match on the same config
//
// Every event first fires the timers due by its `now`, then applies itself.
//
// ─── Effects (what the caller must do; plain data) ───────────────────────────
//
//   { type: 'sound', sound: 'yip' | 'growl' }
//   { type: 'attempt', attempt: { operand_a, operand_b, operator, answer,
//                                  outcome: 'child' | 'ai', time_ms } }
//   { type: 'wrongTap', wrongTap: { operand_a, operand_b, operator,
//                                    correct_answer, tapped_value, time_ms } }
//
// ─── Random draws, in order (part of the rule — the Swift port depends on it) ─
//
//   deal:            generateProblem(config, rng), then
//                    buildGridFromLayout(answer, config, layout, rng)
//   opponent start:  one draw, after any deal in the same step
//   hint2x2:         one draw to pick a window; if none qualifies, a shuffle
//                    of the wrong cells
//   mushroomGrove, lightningStrike: a shuffle of the wrong cells
//   shuffle:         Fisher–Yates from the last index down,
//                    j = floor(rng() * (i + 1))

import { buildGridFromLayout, generateProblem, PROBLEMS_TO_WIN } from '../data/battleData.js';
import { DEFAULT_BATTLE_SETTINGS } from '../data/battleSettings.js';
import { isUntimed, normalizePace, PACE, paceFactor } from './pace.js';

// The timings that are served (blank, lock, flash, opponent pace) live in
// state.settings; these two are fixed.
export const COOLDOWN_TICK_MS = 100;
// lightningStrike removes at most this many wrong cells.
export const LIGHTNING_MAX_CELLS = 4;

export const TIMER = Object.freeze({
  OPPONENT_SOLVE: 'opponentSolve',
  NEXT_PROBLEM: 'nextProblem',
  UNLOCK_GRID: 'unlockGrid',
  CLEAR_WRONG_FLASH: 'clearWrongFlash',
  CLEAR_HINT: 'clearHint',
  CLEAR_REVEAL: 'clearReveal',
  END_AI_LOCKOUT: 'endAiLockout',
  COOLDOWN_TICK: 'cooldownTick',
});

// Fields a new match starts from (shared by createBattleState and retry).
const FRESH_MATCH = {
  playerScore: 0,
  aiScore: 0,
  status: 'playing',
  wrongCellIndex: null,
  gridLocked: false,
  blanking: false,
  aiSolvedAnswer: null,
  aiEatCellIndex: null,
  hintCellIndices: null,
  hintColor: null,
  revealCellIndex: null,
  mushroomCellIndices: null,
  zappedCellIndices: null,
  aiLocked: false,
  shieldActive: false,
  bondCooldownMs: 0,
  bondCooldownTotalMs: 0,
  matchDurationMs: null,
};

// A dealt, not-yet-started battle: the first problem is on the board but no
// clock runs until `start`.
export function createBattleState(
  { config, layout, target = PROBLEMS_TO_WIN, settings = DEFAULT_BATTLE_SETTINGS, pace = PACE.NORMAL },
  rng = Math.random,
) {
  const s = {
    config,
    layout,
    target,
    settings: { ...settings },
    pace: normalizePace(pace),
    problem: null,
    grid: null,
    round: 0,
    ...FRESH_MATCH,
    matchStartedAt: null,
    problemStartedAt: null,
    timers: [],
    nextTimerId: 1,
  };
  deal(s, rng);
  return s;
}

export function isBondActive(state) {
  return state.hintCellIndices !== null ||
    state.revealCellIndex !== null ||
    state.mushroomCellIndices !== null ||
    state.zappedCellIndices !== null ||
    state.aiLocked ||
    state.shieldActive;
}

// The earliest pending deadline, for the caller to schedule a `tick` at.
export function nextTimerAt(state) {
  const next = earliestTimer(state.timers);
  return next ? next.at : null;
}

export function stepBattle(state, event, rng = Math.random) {
  // Work on a shallow copy. Nested values (problem, grid, config, layout, the
  // cell-index arrays, timers) are never mutated, only replaced.
  const s = { ...state };
  const effects = [];
  let changed = advance(s, event.now, rng, effects);
  const afterTimers = { ...s };

  switch (event.type) {
    case 'tick':
      break;
    case 'start':
      s.matchStartedAt = event.now;
      s.problemStartedAt = event.now;
      changed = true;
      break;
    case 'tap':
      changed = tap(s, event.cell, event.now, effects) || changed;
      break;
    case 'bondPower':
      changed = bondPower(s, event.power, event.now, rng) || changed;
      break;
    case 'settingsLoaded':
      s.settings = { ...event.settings };
      changed = true;
      break;
    case 'configLoaded':
      s.config = event.config;
      s.layout = event.layout;
      deal(s, rng);
      s.problemStartedAt = event.now;
      changed = true;
      break;
    case 'retry':
      Object.assign(s, FRESH_MATCH);
      cancelTimers(s, TIMER.UNLOCK_GRID);
      cancelTimers(s, TIMER.COOLDOWN_TICK);
      deal(s, rng);
      s.matchStartedAt = event.now;
      s.problemStartedAt = event.now;
      changed = true;
      break;
    default:
      throw new Error(`unknown battle event: ${event.type}`);
  }

  if (!changed) return { state, effects };
  syncOpponent(afterTimers, s, event.now, rng);
  return { state: s, effects };
}

// ─── internals (all mutate the working copy `s`) ─────────────────────────────

function deal(s, rng) {
  const problem = generateProblem(s.config, rng);
  s.problem = problem;
  s.grid = buildGridFromLayout(problem.answer, s.config, s.layout, rng);
  s.round += 1;
}

function earliestTimer(timers) {
  let best = null;
  for (const t of timers) {
    if (!best || t.at < best.at || (t.at === best.at && t.id < best.id)) best = t;
  }
  return best;
}

function addTimer(s, kind, at, id = s.nextTimerId) {
  s.timers = [...s.timers, { id, kind, at }];
  if (id === s.nextTimerId) s.nextTimerId += 1;
}

function cancelTimers(s, kind) {
  if (s.timers.some(t => t.kind === kind)) s.timers = s.timers.filter(t => t.kind !== kind);
}

// Fire every timer due by `now`, earliest first, re-syncing the opponent after
// each (a fire can start or stop it). Returns whether anything fired.
function advance(s, now, rng, effects) {
  let fired = false;
  for (;;) {
    const due = earliestTimer(s.timers);
    if (!due || due.at > now) return fired;
    const before = { ...s };
    s.timers = s.timers.filter(t => t !== due);
    fireTimer(s, due, rng, effects);
    syncOpponent(before, s, due.at, rng);
    fired = true;
  }
}

function fireTimer(s, timer, rng, effects) {
  const at = timer.at;
  switch (timer.kind) {
    case TIMER.OPPONENT_SOLVE: {
      const p = s.problem;
      effects.push({
        type: 'attempt',
        attempt: {
          operand_a: p.a,
          operand_b: p.b,
          operator: p.op,
          answer: p.answer,
          outcome: 'ai',
          time_ms: at - (s.problemStartedAt ?? at),
        },
      });
      effects.push({ type: 'sound', sound: 'growl' });
      endProblem(s, 'ai', at);
      break;
    }
    case TIMER.NEXT_PROBLEM:
      // Dealt from the CURRENT config/layout, which a server config may have
      // replaced during the blank.
      deal(s, rng);
      s.problemStartedAt = at;
      s.blanking = false;
      s.aiSolvedAnswer = null;
      s.aiEatCellIndex = null;
      // A fresh problem is always tappable, even mid wrong-tap pause.
      cancelTimers(s, TIMER.UNLOCK_GRID);
      s.gridLocked = false;
      break;
    case TIMER.UNLOCK_GRID:
      s.gridLocked = false;
      break;
    case TIMER.CLEAR_WRONG_FLASH:
      s.wrongCellIndex = null;
      break;
    case TIMER.CLEAR_HINT:
      s.hintCellIndices = null;
      s.hintColor = null;
      break;
    case TIMER.CLEAR_REVEAL:
      s.revealCellIndex = null;
      s.hintColor = null;
      break;
    case TIMER.END_AI_LOCKOUT:
      s.aiLocked = false;
      break;
    case TIMER.COOLDOWN_TICK:
      s.bondCooldownMs = Math.max(0, s.bondCooldownMs - COOLDOWN_TICK_MS);
      if (s.bondCooldownMs > 0) addTimer(s, TIMER.COOLDOWN_TICK, at + COOLDOWN_TICK_MS, timer.id);
      break;
    default:
      throw new Error(`unknown battle timer: ${timer.kind}`);
  }
}

function opponentCanRun(s) {
  return s.matchStartedAt !== null && s.status === 'playing' && !s.blanking && !s.aiLocked &&
    !isUntimed(s.pace);
}

// Start, restart or stop the opponent to match the transition prev → s.
function syncOpponent(prev, s, now, rng) {
  const runs = opponentCanRun(s);
  const ran = opponentCanRun(prev);
  if (runs && ran && prev.round === s.round && prev.config.aiSeconds === s.config.aiSeconds) return;
  if (!runs && !ran) return;
  cancelTimers(s, TIMER.OPPONENT_SOLVE);
  if (!runs) return;
  const { aiJitterFraction, aiMinDelayMs } = s.settings;
  const base = s.config.aiSeconds * 1000 * paceFactor(s.pace);
  const jitter = base * aiJitterFraction * (rng() - 0.5);
  addTimer(s, TIMER.OPPONENT_SOLVE, now + Math.max(aiMinDelayMs, base + jitter));
}

// The current problem is over: someone solved it. Blanks the grid, then the
// nextProblem timer deals a fresh one — even after the final point, since the
// result screen covers the grid by then.
function endProblem(s, winner, now) {
  if (winner === 'player') {
    s.playerScore += 1;
    if (s.playerScore >= s.target && s.status === 'playing') finish(s, 'won', now);
  } else {
    s.aiScore += 1;
    if (s.aiScore >= s.target && s.status === 'playing') finish(s, 'lost', now);
    const answer = s.problem.answer;
    s.aiSolvedAnswer = answer;
    // Pounce on the cell holding the answer so the opponent can gobble it.
    const eatIdx = s.grid.indexOf(answer);
    s.aiEatCellIndex = eatIdx >= 0 ? eatIdx : null;
  }
  s.blanking = true;
  // Per-problem bond effects clear with the problem: their cell indices point
  // into the old grid, and an unused shield is per-problem.
  s.mushroomCellIndices = null;
  s.zappedCellIndices = null;
  s.revealCellIndex = null;
  s.shieldActive = false;
  const { gridBlankAiMs, gridBlankMs } = s.settings;
  addTimer(s, TIMER.NEXT_PROBLEM, now + (winner === 'ai' ? gridBlankAiMs : gridBlankMs));
}

// The match is decided: every bond effect and the cooldown clear, and the
// duration is stamped.
function finish(s, status, now) {
  s.status = status;
  s.hintCellIndices = null;
  s.hintColor = null;
  s.revealCellIndex = null;
  s.mushroomCellIndices = null;
  s.zappedCellIndices = null;
  s.aiLocked = false;
  s.shieldActive = false;
  s.bondCooldownMs = 0;
  cancelTimers(s, TIMER.COOLDOWN_TICK);
  s.matchDurationMs = now - (s.matchStartedAt ?? now);
}

function tap(s, cell, now, effects) {
  if (s.status !== 'playing' || s.blanking || s.gridLocked) return false;
  // Mushroom-covered and lightning-zapped cells are inert: no answer match,
  // no wrong-tap penalty.
  if (s.mushroomCellIndices?.includes(cell)) return false;
  if (s.zappedCellIndices?.includes(cell)) return false;

  const value = s.grid[cell] ?? null;
  const timeMs = now - (s.problemStartedAt ?? now);
  const p = s.problem;
  if (value === p.answer) {
    effects.push({
      type: 'attempt',
      attempt: {
        operand_a: p.a,
        operand_b: p.b,
        operator: p.op,
        answer: p.answer,
        outcome: 'child',
        time_ms: timeMs,
      },
    });
    effects.push({ type: 'sound', sound: 'yip' });
    endProblem(s, 'player', now);
    return true;
  }

  effects.push({
    type: 'wrongTap',
    wrongTap: {
      operand_a: p.a,
      operand_b: p.b,
      operator: p.op,
      correct_answer: p.answer,
      tapped_value: value,
      time_ms: timeMs,
    },
  });
  s.wrongCellIndex = cell;
  addTimer(s, TIMER.CLEAR_WRONG_FLASH, now + s.settings.wrongFlashMs);
  // The petal shield forgives one wrong tap: it still flashes and is logged,
  // but the grid does not lock. One-shot.
  if (s.shieldActive) {
    s.shieldActive = false;
    return true;
  }
  // Lock the whole grid so the child slows down and reconsiders rather than
  // tapping rapidly through the options. The next problem lifts it early.
  s.gridLocked = true;
  cancelTimers(s, TIMER.UNLOCK_GRID);
  addTimer(s, TIMER.UNLOCK_GRID, now + s.settings.gridLockMs);
  return true;
}

function shuffled(values, rng) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A Bond Power. Refused (no state change, no cooldown) while one is active, on
// cooldown, between problems, or when the power cannot apply to this grid.
function bondPower(s, power, now, rng) {
  if (!power || s.status !== 'playing' || s.blanking) return false;
  if (s.bondCooldownMs > 0 || isBondActive(s)) return false;

  const { grid, problem } = s;
  const { cols, rows } = s.layout;
  const answerIdx = grid.indexOf(problem.answer);
  // Active cells holding a wrong value (not spacers, not the answer).
  const wrongIndices = [];
  grid.forEach((v, i) => { if (v !== null && v !== problem.answer) wrongIndices.push(i); });

  switch (power.kind) {
    case 'hint2x2': {
      // Every 2x2 window with ≥3 active cells that contains the answer. On a
      // sparse layout with none, fall back to the answer cell plus up to 2
      // random wrong cells — so the peek always includes the answer.
      const windows = [];
      for (let r = 0; r <= rows - 2; r++) {
        for (let c = 0; c <= cols - 2; c++) {
          const idxs = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1];
          const active = idxs.filter(idx => grid[idx] !== null);
          if (active.length < 3) continue;
          if (!active.some(idx => grid[idx] === problem.answer)) continue;
          windows.push(active);
        }
      }
      let cells;
      if (windows.length > 0) {
        cells = windows[Math.floor(rng() * windows.length)];
      } else {
        if (answerIdx === -1) return false;
        cells = [answerIdx, ...shuffled(wrongIndices, rng).slice(0, 2)];
      }
      s.hintCellIndices = cells;
      s.hintColor = power.highlightColor ?? null;
      addTimer(s, TIMER.CLEAR_HINT, now + (power.durationMs || 0));
      break;
    }
    case 'revealAnswer':
      // Pinpoints the exact answer cell — the strongest hint.
      if (answerIdx === -1) return false;
      s.revealCellIndex = answerIdx;
      s.hintColor = power.highlightColor ?? null;
      addTimer(s, TIMER.CLEAR_REVEAL, now + (power.durationMs || 0));
      break;
    case 'mushroomGrove': {
      // Cover half the wrong cells (rounded up) until the next problem.
      const order = shuffled(wrongIndices, rng);
      s.mushroomCellIndices = order.slice(0, Math.ceil(order.length / 2));
      break;
    }
    case 'lightningStrike': {
      // Zap up to LIGHTNING_MAX_CELLS wrong cells until the next problem.
      const order = shuffled(wrongIndices, rng);
      s.zappedCellIndices = order.slice(0, Math.min(LIGHTNING_MAX_CELLS, order.length));
      break;
    }
    case 'aiLockout':
      s.aiLocked = true;
      addTimer(s, TIMER.END_AI_LOCKOUT, now + (power.durationMs || 0));
      break;
    case 'petalShield':
      // Armed until it absorbs a wrong tap or the problem ends.
      s.shieldActive = true;
      break;
    default:
      return false;
  }

  s.bondCooldownTotalMs = power.cooldownMs;
  s.bondCooldownMs = power.cooldownMs;
  if (s.bondCooldownMs > 0) addTimer(s, TIMER.COOLDOWN_TICK, now + COOLDOWN_TICK_MS);
  return true;
}
