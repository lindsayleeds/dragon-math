// The pure trial rules, driven directly with a seeded rng and a fake clock.
// useDragonTrial.test.jsx pins the hook's observable contract; these pin the
// step functions the hook and the Swift port both build on, and check that the
// golden runs reach every placement the trial can produce.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';
import { buildGoldenFiles } from './golden';
import {
  ALL_MASTERED_NODE,
  BASELINE_PER_OP,
  OP_START_NODE,
  TRIAL_OPS,
  createTrialState,
  nextProblem,
  pointsForCorrect,
  problemSignature,
  skipProblem,
  startProblemClock,
  tapAnswer,
} from './dragonTrial';

function seededEnv(seed, start = 0) {
  const clock = { now: start };
  return { clock, env: { rng: createSeededRandom(seed).next, clock: () => clock.now } };
}

// Answer every problem fast and correctly, returning every state visited.
function runFlawless(seed) {
  const { clock, env } = seededEnv(seed);
  let state = startProblemClock(createTrialState(env), env);
  const states = [state];
  while (state.status === 'playing') {
    clock.now += 1000;
    state = nextProblem(tapAnswer(state, true, env), env);
    states.push(state);
  }
  return states;
}

describe('dragonTrial rules', () => {
  it('repeats exactly for the same seed', () => {
    expect(runFlawless(5)).toEqual(runFlawless(5));
    expect(runFlawless(5)).not.toEqual(runFlawless(6));
  });

  it('opens on a shuffled baseline of BASELINE_PER_OP problems per op', () => {
    const { env } = seededEnv(1);
    const state = createTrialState(env);
    expect(state.sequence).toHaveLength(TRIAL_OPS.length * BASELINE_PER_OP);
    for (const op of TRIAL_OPS) {
      expect(state.sequence.filter(o => o === op)).toHaveLength(BASELINE_PER_OP);
    }
    expect(state.problem.op).toBe(state.sequence[0]);
    expect(state.problemStartedAt).toBeNull();
  });

  it('never asks the same question twice', () => {
    const last = runFlawless(9).at(-1);
    expect(new Set(last.askedSignatures).size).toBe(last.askedSignatures.length);
  });

  it('scores a correct tap by attempt and time since the problem appeared', () => {
    const { clock, env } = seededEnv(2, 10_000);
    let state = startProblemClock(createTrialState(env), env);
    clock.now += 7000;
    state = tapAnswer(state, false, env);
    expect(state.resolved).toBe(false);
    state = tapAnswer(state, true, env);
    expect(state.perOpPoints[state.problem.op]).toEqual([pointsForCorrect(1, 7000)]);
    expect(pointsForCorrect(1, 7000)).toBe(135);
  });

  it('zeroes a problem on the second wrong tap and ignores input once resolved', () => {
    const { env } = seededEnv(3);
    let state = startProblemClock(createTrialState(env), env);
    state = tapAnswer(tapAnswer(state, false, env), false, env);
    expect(state.resolved).toBe(true);
    expect(tapAnswer(state, true, env)).toBe(state);
    expect(skipProblem(state)).toBe(state);
    expect(state.perOpPoints[state.problem.op]).toEqual([0]);
  });

  it('does not mutate the state it is given', () => {
    const { env } = seededEnv(4);
    const state = startProblemClock(createTrialState(env), env);
    const snapshot = structuredClone(state);
    nextProblem(tapAnswer(state, true, env), env);
    expect(state).toEqual(snapshot);
  });

  it('times each new problem from when nextProblem poses it', () => {
    const { clock, env } = seededEnv(5);
    let state = startProblemClock(createTrialState(env), env);
    state = skipProblem(state);
    clock.now = 4321;
    state = nextProblem(state, env);
    expect(state.problemStartedAt).toBe(4321);
    expect(state.index).toBe(1);
    expect(state.askedSignatures.at(-1)).toBe(problemSignature(state.problem));
  });

  it('golden runs cover every starting node the trial can place at', () => {
    const { runs } = buildGoldenFiles()['trial.json'];
    const reached = new Set(runs.map(r => r.outcome.targetNodeId));
    const possible = [...Object.values(OP_START_NODE), ALL_MASTERED_NODE];
    expect([...reached].sort((a, b) => a - b)).toEqual(possible.sort((a, b) => a - b));
  });
});
