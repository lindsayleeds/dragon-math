import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildGridFromLayout,
  generateProblem,
  getBattleLayout,
} from '../data/battleData';

// =============================================================================
// The Dragon's Trial — v2: adaptive placement test.
//
// Goals (see docs/TRIAL.md):
//   • Roughly assess add / sub / mul / div fluency in 5–10 minutes.
//   • Spend more questions where the result is uncertain or placement-critical;
//     stop probing harder ops once an easier op clearly fails.
//   • Don't penalize slow-but-correct kids: a hard timeout never zeros a
//     correct answer. Speed only reduces points.
//   • Output a per-op score 0–1000 + a 1–5★ band, then place the kid at the
//     start of the first op (add → sub → mul) they have NOT mastered, so the
//     starting node is challenging rather than review. Division is
//     informational only — there is no division-focused world yet.
//
// Adaptive flow:
//   Phase 1 (baseline): BASELINE_PER_OP problems for each of [add, sub, mul,
//     div], shuffled together so the kid can't predict the op.
//   Phase 2 (probing): walk ops in order [add, sub, mul, div]. For each, if
//     the baseline result was "uncertain", add PROBE_UNCERTAIN problems; if
//     "strong", add a couple of confirmation problems. If "weak", stop —
//     no point measuring harder ops once an easier one failed.
//   Hard cap of MAX_TOTAL_PROBLEMS prevents runaway length.
// =============================================================================

const BASELINE_PER_OP = 3;
const PROBE_UNCERTAIN = 5;
const PROBE_CONFIRM = 2;
const MAX_TOTAL_PROBLEMS = 50;
const TRIAL_OPS = ['add', 'sub', 'mul', 'div'];
const TRIAL_RANGE = [2, 10];

// Scoring constants.
const FIRST_TRY_POINTS = 200;
const SECOND_TRY_POINTS = 150;
const MAX_ATTEMPTS = 2;
const MAX_POINTS_PER_PROBLEM = FIRST_TRY_POINTS;

// Speed multiplier on correct answers. Time is measured from problem display
// to the moment of the correct tap. A correct answer is never worth zero from
// speed alone — only two wrong taps can zero a problem.
const SPEED_BANDS = [
  { maxMs: 4000,  mult: 1.00 },
  { maxMs: 8000,  mult: 0.90 },
  { maxMs: 12000, mult: 0.75 },
  { maxMs: Infinity, mult: 0.60 },
];

// Confidence bands on the normalized 0–1000 score, rendered as 1–5 stars.
const BANDS = [
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
const PLACEMENT_ORDER = ['add', 'sub', 'mul'];
const MASTERY_BAND = 'fluent';
// Start nodes for each op's content, plus the "fluent at all three" target.
const OP_START_NODE = { add: 1, sub: 17, mul: 26 };
const ALL_MASTERED_NODE = 34;

// Atmospheric AI growl — fires periodically but does NOT end the problem.
const AI_GROWL_MS = 12000;
const AI_GROWL_JITTER = 0.3;
const GRID_BLANK_MS = 400;
const TRIAL_WORLD_ID = 5;

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildBaselineSequence() {
  const seq = [];
  for (const op of TRIAL_OPS) {
    for (let i = 0; i < BASELINE_PER_OP; i++) seq.push(op);
  }
  return shuffle(seq);
}

function configForOp(op) {
  return { ops: [op], range: TRIAL_RANGE };
}

// Stable signature for a generated problem so we can avoid asking the same
// question twice. Add/mul are commutative — "2 + 5" and "5 + 2" count as the
// same question to a child.
function problemSignature(p) {
  if (p.op === 'add' || p.op === 'mul') {
    const [lo, hi] = p.a <= p.b ? [p.a, p.b] : [p.b, p.a];
    return `${p.op}|${lo}|${hi}`;
  }
  return `${p.op}|${p.a}|${p.b}`;
}

// Try a handful of times to generate a problem we haven't asked yet. If the
// operand space is exhausted (shouldn't happen at TRIAL_RANGE), fall back to
// the last candidate so the trial can still progress.
function generateUniqueProblem(config, seen) {
  let candidate;
  for (let i = 0; i < 25; i++) {
    candidate = generateProblem(config);
    if (!seen.has(problemSignature(candidate))) return candidate;
  }
  return candidate;
}

function speedMultiplier(timeMs) {
  for (const band of SPEED_BANDS) {
    if (timeMs <= band.maxMs) return band.mult;
  }
  return SPEED_BANDS[SPEED_BANDS.length - 1].mult;
}

// Compute per-op normalized score (0–1000) from an array of per-problem
// outcomes. Each outcome is { points, asked: true }. If no problems were
// asked, score is 0 (not applicable).
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
function buildProbeSequence(baselineByOp, baselineCount) {
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

// Public helper: derive trial outcome (per-op scores, bands, placement node).
// Pure function so the page can re-render it without re-running the hook.
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

export function useDragonTrial() {
  const layout = getBattleLayout(TRIAL_WORLD_ID);

  // Two-phase sequence: baseline is fixed up front; probe is appended once
  // baseline finishes (so probing reflects actual baseline results).
  const baselineSeqRef = useRef(buildBaselineSequence());
  const sequenceRef = useRef(baselineSeqRef.current.slice());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('baseline'); // 'baseline' | 'probe' | 'complete'

  const initialOp = sequenceRef.current[0];
  const askedSignaturesRef = useRef(new Set());
  const [config, setConfig] = useState(() => configForOp(initialOp));
  const [problem, setProblem] = useState(() => {
    const p = generateUniqueProblem(configForOp(initialOp), askedSignaturesRef.current);
    askedSignaturesRef.current.add(problemSignature(p));
    return p;
  });
  const [grid, setGrid] = useState(() => buildGridFromLayout(problem.answer, config, layout));
  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [blanking, setBlanking] = useState(false);
  const [status, setStatus] = useState('playing'); // 'playing' | 'complete'

  // Atmospheric AI score — counts up but never ends a problem.
  const [aiScore, setAiScore] = useState(0);

  // Per-op points: { add: [200, 180, 0, ...], sub: [...], ... }
  const initialPoints = TRIAL_OPS.reduce((acc, op) => { acc[op] = []; return acc; }, {});
  const [perOpPoints, setPerOpPoints] = useState(initialPoints);

  // Refs for values read inside async callbacks.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const configRef = useRef(config);
  configRef.current = config;
  const indexRef = useRef(index);
  indexRef.current = index;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Tracks whether the current problem already counted (so the AI growl after
  // a player solve can't double-record).
  const problemResolvedRef = useRef(false);
  const attemptsRef = useRef(0);
  // Set in an effect so we don't read clock during render. Falls back to "now"
  // if a tap somehow lands before the mount effect runs (shouldn't happen).
  const problemStartRef = useRef(null);
  useEffect(() => {
    if (problemStartRef.current === null) problemStartRef.current = Date.now();
  }, []);
  // Mirrors perOpPoints synchronously for adaptive sequence decisions, since
  // setPerOpPoints batches.
  const perOpPointsRef = useRef(initialPoints);

  const advance = useCallback((points) => {
    if (problemResolvedRef.current) return;
    problemResolvedRef.current = true;

    const currentOp = configRef.current.ops[0];

    // Update both state and ref so the ref is reliable for the next
    // sequencing decision (state updates are async).
    const updated = {
      ...perOpPointsRef.current,
      [currentOp]: [...(perOpPointsRef.current[currentOp] || []), points],
    };
    perOpPointsRef.current = updated;
    setPerOpPoints(updated);

    setBlanking(true);
    setTimeout(() => {
      const nextIdx = indexRef.current + 1;

      // If we just finished the baseline, extend the sequence with adaptive
      // probes. This happens exactly once per trial.
      if (phaseRef.current === 'baseline' && nextIdx >= baselineSeqRef.current.length) {
        const probe = buildProbeSequence(perOpPointsRef.current, baselineSeqRef.current.length);
        sequenceRef.current = [...baselineSeqRef.current, ...probe];
        phaseRef.current = 'probe';
        setPhase('probe');
      }

      if (nextIdx >= sequenceRef.current.length) {
        setStatus('complete');
        setBlanking(false);
        return;
      }

      const nextOp = sequenceRef.current[nextIdx];
      const nextConfig = configForOp(nextOp);
      const nextProblem = generateUniqueProblem(nextConfig, askedSignaturesRef.current);
      askedSignaturesRef.current.add(problemSignature(nextProblem));
      setConfig(nextConfig);
      setProblem(nextProblem);
      setGrid(buildGridFromLayout(nextProblem.answer, nextConfig, layoutRef.current));
      setIndex(nextIdx);
      setBlanking(false);
      problemResolvedRef.current = false;
      attemptsRef.current = 0;
      problemStartRef.current = Date.now();
    }, GRID_BLANK_MS);
  }, []);

  // "Too hard for me" — kid bails on the current problem. Same effect as two
  // wrong taps: zero points, advance to the next problem. Letting kids opt out
  // is gentler than forcing them to guess wrong twice on something they can't
  // do, and it gives the adaptive sequence a clean signal.
  const skipProblem = useCallback(() => {
    if (status !== 'playing' || blanking) return;
    if (problemResolvedRef.current) return;
    advance(0);
  }, [status, blanking, advance]);

  const handleCellTap = useCallback((cellIndex) => {
    if (status !== 'playing' || blanking) return;
    if (problemResolvedRef.current) return;
    const value = grid[cellIndex];
    if (value === problem.answer) {
      const startedAt = problemStartRef.current ?? Date.now();
      const elapsed = Date.now() - startedAt;
      const base = attemptsRef.current === 0 ? FIRST_TRY_POINTS : SECOND_TRY_POINTS;
      const points = Math.round(base * speedMultiplier(elapsed));
      advance(points);
    } else {
      attemptsRef.current += 1;
      setWrongCellIndex(cellIndex);
      setTimeout(() => setWrongCellIndex(null), 350);
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        advance(0);
      }
    }
  }, [grid, problem, status, blanking, advance]);

  // Atmospheric AI growl — fires on a lazy timer but does NOT end the problem
  // or score against the player. Pure flavor.
  useEffect(() => {
    if (status !== 'playing' || blanking) return;
    const jitter = AI_GROWL_MS * AI_GROWL_JITTER * (Math.random() - 0.5);
    const delay = Math.max(4000, AI_GROWL_MS + jitter);
    const timer = setTimeout(() => {
      if (problemResolvedRef.current) return;
      setAiScore(s => s + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [problem, status, blanking]);

  return {
    problem,
    grid,
    layoutCols: layout.cols,
    layoutRows: layout.rows,
    wrongCellIndex,
    blanking,
    status,
    index,
    total: sequenceRef.current.length,
    currentOp: config.ops[0],
    phase,
    perOpPoints,
    aiScore,
    handleCellTap,
    skipProblem,
  };
}

export {
  TRIAL_OPS,
  BASELINE_PER_OP,
  PLACEMENT_ORDER,
  MASTERY_BAND,
  BANDS,
};
