// The Dragon's Trial rules: sequencing, per-problem scoring, adaptive probing
// and placement, as pure functions over a plain-data state (docs/TRIAL.md).
//
// Why this is its own module: the iOS app runs the trial on the device, so the
// same rules live in Swift and are held to these by golden/trial.json
// (ADR 0005). src/hooks/useDragonTrial.js is a thin React wrapper around it and
// owns only the UI bits — the grid, the wrong-cell flash, the blanking delay
// and the atmospheric growl.
//
// Porting notes:
//   - The state is plain data (arrays, strings, numbers, null) so it maps
//     one-to-one onto a Swift struct. Step functions never mutate; each
//     returns a new state.
//   - Randomness and time are injected as `env = { rng, clock }`, both
//     `() => number` (rng in [0, 1), clock in ms), defaulting to Math.random
//     and Date.now so the web trial behaves exactly as before.
//   - The ORDER of rng draws is part of the contract: createTrialState draws
//     the baseline shuffle (Fisher-Yates from the end), then the first
//     problem; nextProblem draws only the next problem. Each problem is
//     generateProblem (src/data/battleData.js) — which draws once to pick the
//     op even though the trial config has a single op — retried up to
//     UNIQUE_RETRIES times while its signature was already asked.

import { generateProblem } from '../data/battleData.js';

export const BASELINE_PER_OP = 3;
export const PROBE_UNCERTAIN = 5;
export const PROBE_CONFIRM = 2;
export const MAX_TOTAL_PROBLEMS = 50;
export const TRIAL_OPS = ['add', 'sub', 'mul', 'div'];
export const TRIAL_RANGE = [2, 10];
const UNIQUE_RETRIES = 25;

// Scoring constants.
export const FIRST_TRY_POINTS = 200;
export const SECOND_TRY_POINTS = 150;
export const MAX_ATTEMPTS = 2;
const MAX_POINTS_PER_PROBLEM = FIRST_TRY_POINTS;

// Speed multiplier on correct answers. Time is measured from problem display
// to the moment of the correct tap. A correct answer is never worth zero from
// speed alone — only two wrong taps can zero a problem.
export const SPEED_BANDS = [
  { maxMs: 4000,  mult: 1.00 },
  { maxMs: 8000,  mult: 0.90 },
  { maxMs: 12000, mult: 0.75 },
  { maxMs: Infinity, mult: 0.60 },
];

// Confidence bands on the normalized 0–1000 score, rendered as 1–5 stars.
export const BANDS = [
  { min: 850, key: 'fluent',     label: 'fluent',     stars: 5 },
  { min: 700, key: 'capable',    label: 'capable',    stars: 4 },
  { min: 500, key: 'developing', label: 'developing', stars: 3 },
  { min: 300, key: 'emerging',   label: 'emerging',   stars: 2 },
  { min: 0,   key: 'not_ready',  label: 'not ready',  stars: 1 },
];

// Placement walks add → sub → mul and drops the kid at the START of the first
// op they haven't mastered, so the starting node is a challenge instead of
// review. "Mastered" = fluent (≥850). Division has no dedicated world yet —
// a kid fluent at all three core ops lands in World 5 (mixed all-ops mastery).
export const PLACEMENT_ORDER = ['add', 'sub', 'mul'];
export const MASTERY_BAND = 'fluent';
// Start nodes for each op's content, plus the "fluent at all three" target.
export const OP_START_NODE = { add: 1, sub: 17, mul: 26 };
export const ALL_MASTERED_NODE = 34;

// Atmospheric AI growl — fires periodically but does NOT end the problem.
const AI_GROWL_MS = 12000;
const AI_GROWL_JITTER = 0.3;
const AI_GROWL_MIN_MS = 4000;

// Looked up per call, so fake timers and spies installed later still apply.
const WEB_ENV = { rng: () => Math.random(), clock: () => Date.now() };

function envOf(env) {
  return { ...WEB_ENV, ...env };
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildBaselineSequence(rng) {
  const seq = [];
  for (const op of TRIAL_OPS) {
    for (let i = 0; i < BASELINE_PER_OP; i++) seq.push(op);
  }
  return shuffle(seq, rng);
}

export function configForOp(op) {
  return { ops: [op], range: TRIAL_RANGE };
}

// Stable signature for a generated problem so we can avoid asking the same
// question twice. Add/mul are commutative — "2 + 5" and "5 + 2" count as the
// same question to a child.
export function problemSignature(p) {
  if (p.op === 'add' || p.op === 'mul') {
    const [lo, hi] = p.a <= p.b ? [p.a, p.b] : [p.b, p.a];
    return `${p.op}|${lo}|${hi}`;
  }
  return `${p.op}|${p.a}|${p.b}`;
}

// Try a handful of times to generate a problem we haven't asked yet. If the
// operand space is exhausted (shouldn't happen at TRIAL_RANGE), fall back to
// the last candidate so the trial can still progress.
function generateUniqueProblem(op, askedSignatures, rng) {
  const config = configForOp(op);
  let candidate;
  for (let i = 0; i < UNIQUE_RETRIES; i++) {
    candidate = generateProblem(config, rng);
    if (!askedSignatures.includes(problemSignature(candidate))) return candidate;
  }
  return candidate;
}

export function speedMultiplier(timeMs) {
  for (const band of SPEED_BANDS) {
    if (timeMs <= band.maxMs) return band.mult;
  }
  return SPEED_BANDS[SPEED_BANDS.length - 1].mult;
}

// Points for a correct tap: 1st or 2nd try, scaled by speed.
export function pointsForCorrect(wrongTapsBefore, elapsedMs) {
  const base = wrongTapsBefore === 0 ? FIRST_TRY_POINTS : SECOND_TRY_POINTS;
  return Math.round(base * speedMultiplier(elapsedMs));
}

// Per-op normalized score (0–1000) from that op's per-problem points. If no
// problems were asked, score is 0 (not applicable).
function normalizeScore(problemPoints) {
  if (problemPoints.length === 0) return 0;
  const raw = problemPoints.reduce((sum, p) => sum + p, 0);
  const max = problemPoints.length * MAX_POINTS_PER_PROBLEM;
  return Math.round((raw / max) * 1000);
}

function bandFor(score) {
  for (const b of BANDS) {
    if (score >= b.min) return b;
  }
  return BANDS[BANDS.length - 1];
}

// Classify a baseline result to decide how many probe problems to add.
function classifyBaseline(opPoints) {
  if (opPoints.length === 0) return 'unknown';
  const score = normalizeScore(opPoints);
  // "Strong" = baseline solidly above the capable bar (some headroom).
  if (score >= 800) return 'strong';
  // "Weak" = baseline below developing — even more questions probably won't
  // rescue this op for placement purposes.
  if (score < 400) return 'weak';
  return 'uncertain';
}

// Build the probing sequence given baseline results. Walks ops in order; once
// we hit a weak op we stop adding probes for *harder* ops (placement-wise the
// kid won't be placed there anyway). Respects MAX_TOTAL_PROBLEMS.
export function buildProbeSequence(baselineByOp, baselineCount) {
  const out = [];
  let total = baselineCount;
  let hitWeak = false;

  for (const op of TRIAL_OPS) {
    if (total >= MAX_TOTAL_PROBLEMS) break;
    const klass = classifyBaseline(baselineByOp[op] || []);

    let probeCount = 0;
    if (klass === 'uncertain') probeCount = PROBE_UNCERTAIN;
    else if (klass === 'strong' && !hitWeak) probeCount = PROBE_CONFIRM;
    else if (klass === 'weak') {
      // Don't probe further — easier ops failed, so multiplication/division
      // are unlikely to change placement.
      hitWeak = true;
      probeCount = 0;
    }

    const available = MAX_TOTAL_PROBLEMS - total;
    probeCount = Math.min(probeCount, available);
    for (let i = 0; i < probeCount; i++) out.push(op);
    total += probeCount;

    if (hitWeak) break;
  }

  return out;
}

// Derive the trial outcome (per-op scores, bands, placement node) from the
// per-op points. Pure so the page can re-render it without re-running the trial.
export function computeTrialOutcome(perOpPoints) {
  const perOp = {};
  for (const op of TRIAL_OPS) {
    const pts = perOpPoints[op] || [];
    const score = normalizeScore(pts);
    const band = bandFor(score);
    perOp[op] = {
      score,
      band: band.key,
      bandLabel: band.label,
      stars: band.stars,
      problemsAsked: pts.length,
    };
  }

  // Walk add→sub→mul; the first op that isn't mastered is the placement op.
  // Track the highest mastered op too (informational, persisted for parents).
  let highestMastered = null;
  let placementOp = null;
  for (const op of PLACEMENT_ORDER) {
    if (perOp[op].band === MASTERY_BAND) {
      highestMastered = op;
    } else if (placementOp === null) {
      placementOp = op;
    }
  }
  const targetNodeId = placementOp ? OP_START_NODE[placementOp] : ALL_MASTERED_NODE;

  return { perOp, highestMasteredOp: highestMastered, placementOp, targetNodeId };
}

// Delay before the next atmospheric growl: AI_GROWL_MS ± 15%, never under 4s.
export function aiGrowlDelayMs(rng = Math.random) {
  const jitter = AI_GROWL_MS * AI_GROWL_JITTER * (rng() - 0.5);
  return Math.max(AI_GROWL_MIN_MS, AI_GROWL_MS + jitter);
}

// ─── The trial as a sequence of plain-data states ────────────────────────────
//
// TrialState:
//   sequence          op per problem; baseline only until the probe is decided
//   baselineLength    TRIAL_OPS.length × BASELINE_PER_OP
//   index             position of `problem` in `sequence`
//   phase             'baseline' | 'probe' (stays 'probe' once complete)
//   status            'playing' | 'complete'
//   problem           { a, b, op, text, answer } on screen
//   askedSignatures   problemSignature of every problem posed, in order
//   perOpPoints       { add: [200, 0, …], sub: […], mul: […], div: […] }
//   wrongTaps         wrong taps on the current problem
//   resolved          current problem already scored; taps and skips ignored
//   problemStartedAt  clock ms when the problem appeared, or null before the
//                     first startProblemClock
//
// A problem's life: tapAnswer / skipProblem until `resolved`, then (after the
// UI's blank) nextProblem, which extends the sequence with the probe exactly
// once when the baseline runs out, and completes the trial at the end.

export function createTrialState(env) {
  const { rng } = envOf(env);
  const sequence = buildBaselineSequence(rng);
  const problem = generateUniqueProblem(sequence[0], [], rng);
  return {
    sequence,
    baselineLength: sequence.length,
    index: 0,
    phase: 'baseline',
    status: 'playing',
    problem,
    askedSignatures: [problemSignature(problem)],
    perOpPoints: TRIAL_OPS.reduce((acc, op) => { acc[op] = []; return acc; }, {}),
    wrongTaps: 0,
    resolved: false,
    problemStartedAt: null,
  };
}

// Start timing the first problem once it is actually on screen. Later problems
// are timed from nextProblem, so this is a no-op once a start time is set.
export function startProblemClock(state, env) {
  if (state.problemStartedAt !== null) return state;
  return { ...state, problemStartedAt: envOf(env).clock() };
}

function canAnswer(state) {
  return state.status === 'playing' && !state.resolved;
}

function resolveWith(state, points) {
  const op = state.problem.op;
  return {
    ...state,
    resolved: true,
    perOpPoints: { ...state.perOpPoints, [op]: [...state.perOpPoints[op], points] },
  };
}

// A tap on the grid. A correct tap scores by attempt and speed; the
// MAX_ATTEMPTS-th wrong tap scores 0. Either resolves the problem.
export function tapAnswer(state, isCorrect, env) {
  if (!canAnswer(state)) return state;
  if (isCorrect) {
    const now = envOf(env).clock();
    const startedAt = state.problemStartedAt ?? now;
    return resolveWith(state, pointsForCorrect(state.wrongTaps, now - startedAt));
  }
  const wrongTaps = state.wrongTaps + 1;
  const next = { ...state, wrongTaps };
  return wrongTaps >= MAX_ATTEMPTS ? resolveWith(next, 0) : next;
}

// "Too hard for me" — same as two wrong taps: zero points, resolved. Gentler
// than making a kid guess wrong twice, and a clean signal for the probe.
export function skipProblem(state) {
  if (!canAnswer(state)) return state;
  return resolveWith(state, 0);
}

// Move past a resolved problem: append the probe once the baseline is done,
// then either pose the next problem or complete the trial.
export function nextProblem(state, env) {
  if (state.status !== 'playing' || !state.resolved) return state;
  const { rng, clock } = envOf(env);
  const nextIdx = state.index + 1;

  let { sequence, phase } = state;
  if (phase === 'baseline' && nextIdx >= state.baselineLength) {
    sequence = [...sequence, ...buildProbeSequence(state.perOpPoints, state.baselineLength)];
    phase = 'probe';
  }

  if (nextIdx >= sequence.length) {
    return { ...state, sequence, phase, status: 'complete' };
  }

  const problem = generateUniqueProblem(sequence[nextIdx], state.askedSignatures, rng);
  return {
    ...state,
    sequence,
    phase,
    index: nextIdx,
    problem,
    askedSignatures: [...state.askedSignatures, problemSignature(problem)],
    wrongTaps: 0,
    resolved: false,
    problemStartedAt: clock(),
  };
}
