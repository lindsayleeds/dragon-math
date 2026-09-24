import { useCallback, useEffect, useRef, useState } from 'react';
import { buildGridFromLayout, getBattleLayout } from '../data/battleData';
import {
  aiGrowlDelayMs,
  configForOp,
  createTrialState,
  nextProblem,
  skipProblem as skipTrialProblem,
  startProblemClock,
  tapAnswer,
} from '../rules/dragonTrial';

// =============================================================================
// The Dragon's Trial — v2: adaptive placement test (see docs/TRIAL.md).
//
// The rules — sequencing, scoring, adaptive probing and placement — live in
// src/rules/dragonTrial.js as pure functions over a plain-data state, so the
// iOS app can port them against golden/trial.json. This hook is the React
// wrapper: it keeps that state, builds the answer grid for each problem, and
// runs the UI timing (the wrong-cell flash, the blank between problems and the
// atmospheric AI growl, which never ends a problem or scores).
// =============================================================================

const GRID_BLANK_MS = 400;
const WRONG_FLASH_MS = 350;
const TRIAL_WORLD_ID = 5;

// The web trial draws from Math.random and times with Date.now, as it always
// has. Looked up per call, so fake timers and spies installed later still apply.
const WEB_ENV = { rng: () => Math.random(), clock: () => Date.now() };

export function useDragonTrial() {
  const layout = getBattleLayout(TRIAL_WORLD_ID);

  // The trial state lives in a ref so the blank-delay timeout and repeat taps
  // read the latest value synchronously; `trial` mirrors it for rendering.
  // Only commit() writes either, so they can't disagree.
  const [trial, setTrial] = useState(() => createTrialState(WEB_ENV));
  const trialRef = useRef(trial);
  const commit = useCallback((next) => {
    trialRef.current = next;
    setTrial(next);
  }, []);

  const [grid, setGrid] = useState(() =>
    buildGridFromLayout(trial.problem.answer, configForOp(trial.problem.op), layout));
  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [blanking, setBlanking] = useState(false);

  // Atmospheric AI score — counts up but never ends a problem.
  const [aiScore, setAiScore] = useState(0);

  // Start the clock on the first problem once it's mounted, not during render.
  useEffect(() => {
    commit(startProblemClock(trialRef.current, WEB_ENV));
  }, [commit]);

  // After a problem resolves: blank the grid, then swap in the next problem
  // (or finish). The layout never changes, so the mount-time one is reused.
  const layoutRef = useRef(layout);
  const resolve = useCallback((resolvedState) => {
    commit(resolvedState);
    setBlanking(true);
    setTimeout(() => {
      const next = nextProblem(trialRef.current, WEB_ENV);
      if (next.status === 'playing') {
        setGrid(buildGridFromLayout(next.problem.answer, configForOp(next.problem.op), layoutRef.current));
      }
      commit(next);
      setBlanking(false);
    }, GRID_BLANK_MS);
  }, [commit]);

  // "Too hard for me" — zero points, advance to the next problem.
  const skipProblem = useCallback(() => {
    if (blanking) return;
    const current = trialRef.current;
    const next = skipTrialProblem(current);
    if (next !== current) resolve(next);
  }, [blanking, resolve]);

  const handleCellTap = useCallback((cellIndex) => {
    if (blanking) return;
    const current = trialRef.current;
    if (current.status !== 'playing' || current.resolved) return;
    const isCorrect = grid[cellIndex] === current.problem.answer;
    const next = tapAnswer(current, isCorrect, WEB_ENV);
    if (!isCorrect) {
      setWrongCellIndex(cellIndex);
      setTimeout(() => setWrongCellIndex(null), WRONG_FLASH_MS);
    }
    if (next.resolved) resolve(next);
    else commit(next);
  }, [grid, blanking, resolve, commit]);

  // Atmospheric AI growl — fires on a lazy timer but does NOT end the problem
  // or score against the player. Pure flavor.
  const { problem, status } = trial;
  useEffect(() => {
    if (status !== 'playing' || blanking) return;
    const timer = setTimeout(() => {
      if (trialRef.current.resolved) return;
      setAiScore(s => s + 1);
    }, aiGrowlDelayMs(WEB_ENV.rng));
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
    index: trial.index,
    total: trial.sequence.length,
    currentOp: problem.op,
    phase: trial.phase,
    perOpPoints: trial.perOpPoints,
    aiScore,
    handleCellTap,
    skipProblem,
  };
}

export {
  computeTrialOutcome,
  TRIAL_OPS,
  BASELINE_PER_OP,
  PLACEMENT_ORDER,
  MASTERY_BAND,
  BANDS,
} from '../rules/dragonTrial';
