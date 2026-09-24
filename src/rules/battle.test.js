// Properties of the battle reducer that the golden transcripts cannot show on
// their own: that it is pure, that its state is plain data, and that how often
// the clock is ticked does not change the outcome. Behaviour is pinned by
// golden/battle-transcripts.json (golden.test.js) and, through the hook, by
// src/hooks/useBattle.test.jsx.

import { describe, it, expect, vi } from 'vitest';
import { getBattleLayout, getDefaultBattleConfig } from '../data/battleData.js';
import { createBattleState, nextTimerAt, stepBattle, TIMER } from './battle.js';
import { battleTranscriptsFixture } from './battleTranscripts.js';
import { createSeededRandom } from './seededRandom.js';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function newBattle(seed = 5, rng = createSeededRandom(seed).next) {
  const state = createBattleState({ config: getDefaultBattleConfig(9), layout: getBattleLayout(2) }, rng);
  return { rng, state: stepBattle(state, { type: 'start', now: 0 }, rng).state };
}

const answerCell = s => s.grid.indexOf(s.problem.answer);

describe('battle reducer', () => {
  it('never mutates the state it is given', () => {
    const { rng, state } = newBattle();
    deepFreeze(state);
    const events = [
      { type: 'bondPower', now: 100, power: { kind: 'mushroomGrove', cooldownMs: 1000 } },
      { type: 'tap', now: 200, cell: answerCell(state) },
      { type: 'tick', now: 60_000 },
    ];
    let s = state;
    for (const event of events) {
      expect(() => { s = deepFreeze(stepBattle(s, event, rng).state); }).not.toThrow();
    }
    expect(s.playerScore).toBe(1);
  });

  it('returns the same state object for an event that changes nothing', () => {
    const { rng, state } = newBattle();
    expect(stepBattle(state, { type: 'tick', now: 10 }, rng).state).toBe(state);
    const unknownPower = stepBattle(state, { type: 'bondPower', now: 10, power: { kind: 'nope', cooldownMs: 5 } }, rng);
    expect(unknownPower.state).toBe(state);
  });

  it('keeps its state plain data', () => {
    const { state } = newBattle();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('reaches the same state from one late tick as from on-time ticks', () => {
    // Play a few problems with a power on cooldown, ticking either at every
    // deadline or only once at the end, from the same seed.
    const play = (onTime) => {
      const rng = createSeededRandom(11).next;
      let { state: s } = newBattle(11, rng);
      const send = event => { s = stepBattle(s, event, rng).state; };
      send({ type: 'bondPower', now: 50, power: { kind: 'petalShield', cooldownMs: 1500 } });
      if (onTime) {
        while (nextTimerAt(s) !== null && nextTimerAt(s) <= 40_000) send({ type: 'tick', now: nextTimerAt(s) });
      }
      send({ type: 'tick', now: 40_000 });
      return s;
    };
    const late = play(false);
    expect(late.aiScore).toBeGreaterThan(1);
    expect(late).toEqual(play(true));
  });

  it('draws only from the injected rng, never Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      battleTranscriptsFixture();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an unknown event loudly', () => {
    const { rng, state } = newBattle();
    expect(() => stepBattle(state, { type: 'nope', now: 0 }, rng)).toThrow(/unknown battle event/);
  });
});

describe('battle transcripts fixture', () => {
  const { transcripts } = battleTranscriptsFixture();
  const states = transcripts.flatMap(t => t.steps.map(step => step.state));

  it('covers a win, a loss, a locked grid and the opponent scoring', () => {
    expect(states.some(s => s.status === 'won')).toBe(true);
    expect(states.some(s => s.status === 'lost')).toBe(true);
    expect(states.some(s => s.gridLocked)).toBe(true);
    const opponentSolves = transcripts.flatMap(t => t.steps)
      .filter(step => step.effects.some(e => e.type === 'attempt' && e.attempt.outcome === 'ai'));
    expect(opponentSolves.length).toBeGreaterThan(10);
    expect(states.some(s => s.timers.some(t => t.kind === TIMER.OPPONENT_SOLVE))).toBe(true);
  });

  it('replays to the recorded states', () => {
    for (const t of transcripts) {
      const rng = createSeededRandom(BigInt(t.seed)).next;
      let s = createBattleState(t.init, rng);
      expect(s).toEqual(t.initialState);
      for (const step of t.steps) {
        const out = stepBattle(s, step.event, rng);
        expect(out.effects).toEqual(step.effects);
        expect(out.state).toEqual(step.state);
        s = out.state;
      }
    }
  });
});
