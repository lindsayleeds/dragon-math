// The pure trial rules, driven directly with a seeded rng and a fake clock.
// useDragonTrial.test.jsx pins the hook's observable contract; these pin the
// step functions the hook and the Swift port both build on, and check that the
// golden runs reach every placement the trial can produce.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';
import { buildGoldenFiles } from './golden';
import { DEFAULT_TRIAL_SETTINGS } from '../data/ruleSettings';
import {
  BASELINE_PER_OP,
  TRIAL_OPS,
  aiGrowlDelayMs,
  computeTrialOutcome,
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
    // Runs carrying their own settings place by other nodes.
    const reached = new Set(runs.filter(r => !r.settings).map(r => r.outcome.targetNodeId));
    const { opStartNode, allMasteredNode } = DEFAULT_TRIAL_SETTINGS;
    const possible = [...Object.values(opStartNode), allMasteredNode];
    expect([...reached].sort((a, b) => a - b)).toEqual(possible.sort((a, b) => a - b));
  });
});

describe('trial settings', () => {
  const settings = {
    ...DEFAULT_TRIAL_SETTINGS,
    baselinePerOp: 1,
    maxAttempts: 3,
    firstTryPoints: 100,
    speedBands: [{ maxMs: 1000, mult: 1 }, { maxMs: Infinity, mult: 0.5 }],
    opStartNode: { add: 2, sub: 18, mul: 27 },
  };

  it('are dealt into the state and drive every step', () => {
    const { clock, env } = seededEnv(5);
    let state = startProblemClock(createTrialState({ ...env, settings }), env);
    expect(state.settings).toBe(settings);
    expect(state.sequence).toHaveLength(TRIAL_OPS.length);
    state = tapAnswer(state, false, env);
    state = tapAnswer(state, false, env);
    expect(state.resolved).toBe(false); // a third attempt is allowed
    clock.now = 5000;
    state = tapAnswer(state, true, env);
    expect(state.perOpPoints[state.problem.op]).toEqual([Math.round(150 * 0.5)]);
  });

  it('score and place by the given settings', () => {
    expect(pointsForCorrect(0, 900, settings)).toBe(100);
    expect(pointsForCorrect(0, 1001, settings)).toBe(50);
    const outcome = computeTrialOutcome({ add: [100], sub: [0], mul: [], div: [] }, settings);
    expect(outcome.perOp.add.score).toBe(1000);
    expect(outcome.targetNodeId).toBe(18);
  });

  it('default to the web fallbacks', () => {
    expect(createTrialState({ rng: createSeededRandom(1).next }).settings).toBe(DEFAULT_TRIAL_SETTINGS);
    expect(aiGrowlDelayMs(() => 0.5)).toBe(DEFAULT_TRIAL_SETTINGS.growlMs);
    expect(aiGrowlDelayMs(() => 0, { ...DEFAULT_TRIAL_SETTINGS, growlMs: 1000 })).toBe(DEFAULT_TRIAL_SETTINGS.growlMinMs);
  });
});
