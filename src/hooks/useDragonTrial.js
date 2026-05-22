import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildGridFromLayout,
  generateProblem,
  getBattleLayout,
} from '../data/battleData';

// The Dragon's Trial is a one-time placement test. Unlike a normal battle, the
// AI never "wins" — it just attacks for atmosphere — and the test ends after a
// fixed number of problems per operation rather than at first-to-N.
//
// Structure: PROBLEMS_PER_OP problems for each of [add, sub, mul, div], in a
// shuffled order so the player can't anticipate the operation.

const PROBLEMS_PER_OP = 5;
const TRIAL_OPS = ['add', 'sub', 'mul', 'div'];
// Range chosen to be solvable across all four ops with 6×6 distractor space:
// add/sub/mul/div all stay within ~[2, 100] so the grid stays readable.
const TRIAL_RANGE = [2, 10];
// AI's lazy attack cadence (ms). It scores misses for drama but doesn't end
// the trial — we still want to see the player solve every problem.
const AI_ATTACK_MS = 12000;
const AI_JITTER = 0.3;
const GRID_BLANK_MS = 400;
// Reuse World 5's staircase layout — feels like a final challenge.
const TRIAL_WORLD_ID = 5;

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildSequence() {
  const seq = [];
  for (const op of TRIAL_OPS) {
    for (let i = 0; i < PROBLEMS_PER_OP; i++) seq.push(op);
  }
  return shuffle(seq);
}

function configForOp(op) {
  return { ops: [op], range: TRIAL_RANGE };
}

// Map per-op results → a target node on the existing map. Highest mastered op
// wins. Mastery threshold: 4 of 5 correct. See battleData / mapData for the
// world layout these node ids correspond to.
//   none      → 1   (world 1 start — addition foundation)
//   add only  → 9   (world 2 — addition mastery)
//   sub       → 22  (world 3 mixed +/−)
//   mul       → 34  (world 5 mixed all-ops start)
//   div       → 38  (deeper in world 5)
const MASTERY_THRESHOLD = 4;
const TARGET_BY_HIGHEST_OP = { add: 9, sub: 22, mul: 34, div: 38 };
const OP_ORDER = ['add', 'sub', 'mul', 'div'];

export function computeTrialOutcome(results) {
  let highest = null;
  for (const op of OP_ORDER) {
    if ((results[op]?.correct ?? 0) >= MASTERY_THRESHOLD) highest = op;
  }
  const targetNodeId = highest ? TARGET_BY_HIGHEST_OP[highest] : 1;
  return { highestMasteredOp: highest, targetNodeId };
}

export function useDragonTrial() {
  const layout = getBattleLayout(TRIAL_WORLD_ID);
  const sequenceRef = useRef(buildSequence());
  const [index, setIndex] = useState(0);

  const initialOp = sequenceRef.current[0];
  const [config, setConfig] = useState(() => configForOp(initialOp));
  const [problem, setProblem] = useState(() => generateProblem(configForOp(initialOp)));
  const [grid, setGrid] = useState(() => buildGridFromLayout(problem.answer, config, layout));
  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [blanking, setBlanking] = useState(false);
  const [status, setStatus] = useState('playing'); // 'playing' | 'complete'

  // Atmospheric AI score — counts up but never ends the trial.
  const [aiScore, setAiScore] = useState(0);

  // Per-op tally: { add: { correct, total }, ... }
  const initialResults = TRIAL_OPS.reduce((acc, op) => {
    acc[op] = { correct: 0, total: 0 };
    return acc;
  }, {});
  const [results, setResults] = useState(initialResults);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const configRef = useRef(config);
  configRef.current = config;
  const problemRef = useRef(problem);
  problemRef.current = problem;
  const indexRef = useRef(index);
  indexRef.current = index;
  // Tracks whether the current problem already counted toward results (so an
  // AI attack after the player solves doesn't double-count).
  const problemResolvedRef = useRef(false);

  const advance = useCallback((wasCorrect) => {
    if (problemResolvedRef.current) return;
    problemResolvedRef.current = true;

    const currentOp = configRef.current.ops[0];
    setResults(prev => ({
      ...prev,
      [currentOp]: {
        correct: prev[currentOp].correct + (wasCorrect ? 1 : 0),
        total: prev[currentOp].total + 1,
      },
    }));

    setBlanking(true);
    setTimeout(() => {
      const nextIdx = indexRef.current + 1;
      if (nextIdx >= sequenceRef.current.length) {
        setStatus('complete');
        setBlanking(false);
        return;
      }
      const nextOp = sequenceRef.current[nextIdx];
      const nextConfig = configForOp(nextOp);
      const nextProblem = generateProblem(nextConfig);
      setConfig(nextConfig);
      setProblem(nextProblem);
      setGrid(buildGridFromLayout(nextProblem.answer, nextConfig, layoutRef.current));
      setIndex(nextIdx);
      setBlanking(false);
      problemResolvedRef.current = false;
    }, GRID_BLANK_MS);
  }, []);

  const handleCellTap = useCallback((cellIndex) => {
    if (status !== 'playing' || blanking) return;
    if (problemResolvedRef.current) return;
    const value = grid[cellIndex];
    if (value === problem.answer) {
      advance(true);
    } else {
      setWrongCellIndex(cellIndex);
      setTimeout(() => setWrongCellIndex(null), 350);
    }
  }, [grid, problem, status, blanking, advance]);

  // Atmospheric AI: lazy timer that scores against the player but doesn't end
  // the trial. We still advance to the next problem so the test stays paced.
  useEffect(() => {
    if (status !== 'playing' || blanking) return;
    const jitter = AI_ATTACK_MS * AI_JITTER * (Math.random() - 0.5);
    const delay = Math.max(4000, AI_ATTACK_MS + jitter);
    const timer = setTimeout(() => {
      if (problemResolvedRef.current) return;
      setAiScore(s => s + 1);
      advance(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [problem, status, blanking, advance]);

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
    results,
    aiScore,
    handleCellTap,
  };
}

export { TRIAL_OPS, PROBLEMS_PER_OP, MASTERY_THRESHOLD };
