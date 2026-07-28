// Characterisation tests for the Dragon's Trial placement test.
//
// Why this file exists: useDragonTrial carries 11 of the repo's 20
// react-hooks/refs findings. Every one of them is a render-phase ref write
// (`configRef.current = config` and friends) feeding the `advance` callback,
// which is the mechanism that decides WHICH OP each answer scores against and
// how the adaptive probe sequence is built. A refactor that moves those writes
// into effects — the usual fix — changes when the closure sees a new value, and
// the failure mode is silent: points land on the wrong op and a child gets
// placed in the wrong world. Nothing about that shows up as an exception.
//
// So these tests pin the OBSERVABLE contract rather than the implementation:
// which op gets the points, how many problems get asked, and what placement
// comes out. They should keep passing across any correct refactor of the refs.
//
// The two sources of nondeterminism are mocked at the module boundary:
// generateProblem/buildGridFromLayout (random operands and grid shuffle) and the
// clock (speed multiplier). With the mock below, the correct answer is ALWAYS
// cell 0 and cells 1-3 are always wrong.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDragonTrial, computeTrialOutcome, BASELINE_PER_OP, TRIAL_OPS } from './useDragonTrial';

const state = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../data/battleData', () => ({
  // A 2x2 layout: four active cells, so grids are small and predictable.
  getBattleLayout: () => ({ cols: 2, rows: 2, cells: [true, true, true, true] }),
  // Operand `a` increments on every call so no two problems share a signature —
  // otherwise generateUniqueProblem's 25 retries would all collide.
  generateProblem: (config) => {
    const op = config.ops[0];
    state.counter += 1;
    const a = state.counter;
    const b = 1;
    const answer = op === 'add' ? a + b
      : op === 'sub' ? a - b
        : op === 'mul' ? a * b
          : a;
    return { a, b, op, text: `${a} ${op} ${b}`, answer };
  },
  // Correct answer pinned to cell 0; the rest are guaranteed-wrong sentinels.
  buildGridFromLayout: (answer) => [answer, answer + 100, answer + 200, answer + 300],
}));

const CORRECT_CELL = 0;
const WRONG_CELL = 1;
const BLANK_MS = 400;

beforeEach(() => {
  state.counter = 0;
});

// Resolve one problem and let the 400ms blanking timeout swap the next one in.
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(BLANK_MS);
  });
}

async function answerCorrectly(result) {
  await act(async () => {
    result.current.handleCellTap(CORRECT_CELL);
  });
  await settle();
}

async function tapWrong(result) {
  await act(async () => {
    result.current.handleCellTap(WRONG_CELL);
  });
}

function totalPointsRecorded(perOpPoints) {
  return Object.values(perOpPoints).flat().length;
}

describe('computeTrialOutcome (pure placement maths)', () => {
  const perfect = () => [200, 200, 200];

  it('scores an unanswered trial as zero and places at the very start', () => {
    const out = computeTrialOutcome({});
    for (const op of TRIAL_OPS) {
      expect(out.perOp[op]).toMatchObject({ score: 0, band: 'not_ready', stars: 1, problemsAsked: 0 });
    }
    expect(out.placementOp).toBe('add');
    expect(out.targetNodeId).toBe(1);
    expect(out.highestMasteredOp).toBeNull();
  });

  it('places at the first op that is not mastered, walking add -> sub -> mul', () => {
    expect(computeTrialOutcome({ add: perfect() })).toMatchObject({
      placementOp: 'sub', targetNodeId: 17, highestMasteredOp: 'add',
    });
    expect(computeTrialOutcome({ add: perfect(), sub: perfect() })).toMatchObject({
      placementOp: 'mul', targetNodeId: 26, highestMasteredOp: 'sub',
    });
  });

  it('sends a child fluent in all three core ops to the mixed-mastery node', () => {
    const out = computeTrialOutcome({ add: perfect(), sub: perfect(), mul: perfect() });
    expect(out.placementOp).toBeNull();
    expect(out.targetNodeId).toBe(34);
    expect(out.highestMasteredOp).toBe('mul');
  });

  it('ignores division for placement — it has no world of its own yet', () => {
    const withDiv = computeTrialOutcome({ add: perfect(), sub: perfect(), mul: perfect(), div: [0, 0, 0] });
    expect(withDiv.targetNodeId).toBe(34);
    expect(withDiv.perOp.div.score).toBe(0);
  });

  // normalizeScore is round(raw / (n * 200) * 1000), so with a single problem
  // the score is points * 5 — which makes each band edge exactly reachable.
  it.each([
    [170, 'fluent', 5],
    [169, 'capable', 4],
    [140, 'capable', 4],
    [139, 'developing', 3],
    [100, 'developing', 3],
    [99, 'emerging', 2],
    [60, 'emerging', 2],
    [59, 'not_ready', 1],
  ])('puts %i points on one problem in the %s band', (points, band, stars) => {
    const out = computeTrialOutcome({ add: [points] });
    expect(out.perOp.add.score).toBe(points * 5);
    expect(out.perOp.add.band).toBe(band);
    expect(out.perOp.add.stars).toBe(stars);
  });

  it('reports how many problems each op was actually asked', () => {
    const out = computeTrialOutcome({ add: [200, 150], sub: [0] });
    expect(out.perOp.add.problemsAsked).toBe(2);
    expect(out.perOp.sub.problemsAsked).toBe(1);
    expect(out.perOp.mul.problemsAsked).toBe(0);
  });
});

describe('useDragonTrial', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('opens on a baseline of BASELINE_PER_OP problems for each of the four ops', () => {
    const { result } = renderHook(() => useDragonTrial());
    expect(result.current.total).toBe(TRIAL_OPS.length * BASELINE_PER_OP);
    expect(result.current.index).toBe(0);
    expect(result.current.phase).toBe('baseline');
    expect(result.current.status).toBe('playing');
    expect(result.current.grid).toHaveLength(4);
    expect(TRIAL_OPS).toContain(result.current.currentOp);
  });

  // THE invariant the render-phase refs exist to hold. If `advance` ever reads a
  // stale config, points land on the previous problem's op and the per-op totals
  // stop matching the baseline shape — while everything still "works".
  it('credits every answer to the op that was on screen, across a whole baseline', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const baselineLength = result.current.total;
    const seenOps = [];

    for (let i = 0; i < baselineLength; i++) {
      seenOps.push(result.current.currentOp);
      await answerCorrectly(result);
    }

    // Each op was shown exactly BASELINE_PER_OP times...
    for (const op of TRIAL_OPS) {
      expect(seenOps.filter(o => o === op)).toHaveLength(BASELINE_PER_OP);
      // ...and recorded exactly that many scores.
      expect(result.current.perOpPoints[op]).toHaveLength(BASELINE_PER_OP);
    }
    expect(totalPointsRecorded(result.current.perOpPoints)).toBe(baselineLength);
  });

  it('awards full marks for a fast first-try answer', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await answerCorrectly(result);
    expect(result.current.perOpPoints[op][0]).toBe(200);
  });

  it('reduces points for a slow answer without ever zeroing a correct one', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await answerCorrectly(result);
    // Slowest band is 0.6 of 200. Reduced, but emphatically not zero.
    expect(result.current.perOpPoints[op][0]).toBe(120);
    expect(result.current.perOpPoints[op][0]).toBeGreaterThan(0);
  });

  it('drops a correct answer to second-try points after one wrong tap', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await tapWrong(result);
    expect(result.current.wrongCellIndex).toBe(WRONG_CELL);
    await answerCorrectly(result);
    expect(result.current.perOpPoints[op][0]).toBe(150);
  });

  it('zeroes the problem and moves on after two wrong taps', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await tapWrong(result);
    await tapWrong(result);
    await settle();
    expect(result.current.perOpPoints[op][0]).toBe(0);
    expect(result.current.index).toBe(1);
  });

  it('treats "too hard for me" as a zero rather than forcing two wrong guesses', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await act(async () => { result.current.skipProblem(); });
    await settle();
    expect(result.current.perOpPoints[op][0]).toBe(0);
    expect(result.current.index).toBe(1);
  });

  it('ignores taps while the grid is blanking, so one answer cannot score twice', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const op = result.current.currentOp;
    await act(async () => { result.current.handleCellTap(CORRECT_CELL); });
    expect(result.current.blanking).toBe(true);
    // Frantic double-tap during the blank.
    await act(async () => { result.current.handleCellTap(CORRECT_CELL); });
    await act(async () => { result.current.skipProblem(); });
    await settle();
    expect(result.current.perOpPoints[op]).toHaveLength(1);
    expect(totalPointsRecorded(result.current.perOpPoints)).toBe(1);
  });

  // Across the WHOLE trial, not just the baseline — the probe phase generates
  // from the same `askedSignaturesRef`, so a refactor that reset or re-created
  // that set would start repeating questions only after the baseline ended.
  it('never asks the same question twice, baseline or probe', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const seen = new Set();
    for (let i = 0; i < 60 && result.current.status === 'playing'; i++) {
      const { a, b, op } = result.current.problem;
      const sig = `${op}|${a}|${b}`;
      expect(seen.has(sig)).toBe(false);
      seen.add(sig);
      await answerCorrectly(result);
    }
    expect(result.current.status).toBe('complete');
    // One signature per problem actually scored, and more than the baseline.
    expect(seen.size).toBe(totalPointsRecorded(result.current.perOpPoints));
    expect(seen.size).toBeGreaterThan(TRIAL_OPS.length * BASELINE_PER_OP);
  });

  // The adaptive step, and the reason perOpPointsRef mirrors perOpPoints: the
  // probe sequence is chosen from results that setState has not flushed yet.
  it('extends into a probe phase once the baseline is done', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const baselineLength = result.current.total;

    for (let i = 0; i < baselineLength; i++) await answerCorrectly(result);

    expect(result.current.phase).toBe('probe');
    // A flawless baseline is "strong" on all four ops, so each earns a couple of
    // confirmation problems rather than a full uncertain probe.
    expect(result.current.total).toBeGreaterThan(baselineLength);
    expect(result.current.status).toBe('playing');
  });

  it('stops probing harder ops once an easy one is clearly weak', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const baselineLength = result.current.total;

    // Zero the whole baseline: every op is "weak", so probing must stop at the
    // first one instead of asking another 20 questions of a struggling child.
    for (let i = 0; i < baselineLength; i++) {
      await act(async () => { result.current.skipProblem(); });
      await settle();
    }

    expect(result.current.total).toBe(baselineLength);
    expect(result.current.status).toBe('complete');
  });

  it('completes the trial and leaves the final scores readable', async () => {
    const { result } = renderHook(() => useDragonTrial());
    // Bounded walk: answer until complete, with a cap well above MAX_TOTAL.
    for (let i = 0; i < 60 && result.current.status === 'playing'; i++) {
      await answerCorrectly(result);
    }
    expect(result.current.status).toBe('complete');
    const outcome = computeTrialOutcome(result.current.perOpPoints);
    // Every answer was a fast first-try tap, so this child is fluent throughout
    // and lands on the all-mastered node.
    expect(outcome.perOp.add.band).toBe('fluent');
    expect(outcome.targetNodeId).toBe(34);
  });

  it('lets the atmospheric AI growl tick without ending the problem', async () => {
    const { result } = renderHook(() => useDragonTrial());
    const startingIndex = result.current.index;
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(result.current.aiScore).toBeGreaterThan(0);
    // Flavour only: same problem, still playable, nothing scored.
    expect(result.current.index).toBe(startingIndex);
    expect(result.current.status).toBe('playing');
    expect(totalPointsRecorded(result.current.perOpPoints)).toBe(0);
  });
});
