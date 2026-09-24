// The battle-transcripts golden fixture: scripted battles run through the pure
// battle reducer (src/rules/battle.js) from fixed seeds, recording every input
// event with the effects and full state it produced. The Swift port replays each
// transcript's step events from `initialState` with the same seed and must
// match every step's effects and state exactly.
//
// The scenarios decide their taps by looking at the JavaScript state (e.g.
// "tap the answer cell"), but what is recorded is the literal event, so a
// replay needs no scenario logic.

import { getBattleLayout, getDefaultBattleConfig, getLayoutForShape, PROBLEMS_TO_WIN } from '../data/battleData.js';
import { createBattleState, nextTimerAt, stepBattle, TIMER } from './battle.js';
import { createSeededRandom } from './seededRandom.js';
import { DEFAULT_BATTLE_SETTINGS } from '../data/battleSettings.js';

// The companions' real Bond Powers (src/data/companions.js), as plain data.
const POWERS = {
  hint2x2: { kind: 'hint2x2', cooldownMs: 20_000, durationMs: 2_000, highlightColor: '#9ed8ff' },
  mushroomGrove: { kind: 'mushroomGrove', cooldownMs: 20_000, highlightColor: '#a5e6b8' },
  aiLockout: { kind: 'aiLockout', cooldownMs: 45_000, durationMs: 30_000, highlightColor: '#ffd87a' },
  lightningStrike: { kind: 'lightningStrike', cooldownMs: 25_000, highlightColor: '#d4b8ff' },
  petalShield: { kind: 'petalShield', cooldownMs: 25_000, highlightColor: '#ffc4dd' },
  revealAnswer: { kind: 'revealAnswer', cooldownMs: 22_000, durationMs: 2_200, highlightColor: '#a8d8f0' },
};

// A layout with no 2x2 window of 3+ numbered cells, so hint2x2 must fall back.
const CHECKERBOARD = { cols: 3, rows: 3, cells: [true, false, true, false, true, false, true, false, true] };

const answerCell = s => s.grid.indexOf(s.problem.answer);
const wrongCell = (s, nth = 0) =>
  s.grid.map((v, i) => (v !== null && v !== s.problem.answer ? i : -1)).filter(i => i >= 0)[nth];
const timerAt = (s, kind) => {
  const due = s.timers.filter(t => t.kind === kind).map(t => t.at);
  return due.length ? Math.min(...due) : null;
};

function transcript({ name, description, seed, config, layout }, script) {
  const rng = createSeededRandom(BigInt(seed)).next;
  const init = { config, layout, target: PROBLEMS_TO_WIN, settings: DEFAULT_BATTLE_SETTINGS };
  const initialState = createBattleState(init, rng);
  let state = initialState;
  const steps = [];
  const send = event => {
    const out = stepBattle(state, event, rng);
    state = out.state;
    steps.push({ event, effects: out.effects, state });
    return state;
  };
  const battle = {
    send,
    get state() { return state; },
    // Tick to the earliest timer of `kind` (or the earliest of any kind).
    tickTo: kind => {
      const now = kind ? timerAt(state, kind) : nextTimerAt(state);
      if (now === null) throw new Error(`${name}: no ${kind ?? 'timer'} pending`);
      return send({ type: 'tick', now });
    },
  };
  script(battle);
  return {
    name,
    description,
    seed,
    init,
    initialState,
    steps,
  };
}

function winScenario() {
  return transcript({
    name: 'win',
    description: 'The child answers every problem before the opponent; the tenth point wins and stamps the duration.',
    seed: '1',
    config: getDefaultBattleConfig(1),
    layout: getBattleLayout(1),
  }, b => {
    let now = 0;
    b.send({ type: 'start', now });
    for (let i = 0; i < PROBLEMS_TO_WIN; i++) {
      now += 1200 + i * 150;
      b.send({ type: 'tap', now, cell: answerCell(b.state) });
      b.tickTo(TIMER.NEXT_PROBLEM);
      now = b.state.problemStartedAt;
    }
    // Taps after the match is decided change nothing.
    b.send({ type: 'tap', now: now + 100, cell: answerCell(b.state) });
  });
}

function lossScenario() {
  return transcript({
    name: 'loss',
    description: 'The child never answers: the opponent solves on its jittered pace, gobbles the answer cell, and reaches ten.',
    seed: '42',
    config: getDefaultBattleConfig(8),
    layout: getLayoutForShape('heart', 1),
  }, b => {
    b.send({ type: 'start', now: 1_000_000 });
    while (b.state.status === 'playing') {
      b.tickTo(TIMER.OPPONENT_SOLVE);
      b.tickTo(TIMER.NEXT_PROBLEM);
    }
  });
}

function gridLockScenario() {
  return transcript({
    name: 'grid-lock',
    description:
      'A wrong tap flashes and locks the grid; taps during the lock (even the answer) are ignored; the lock lifts ' +
      'after its pause; a second lock is cleared early when the opponent solves and the next problem is dealt.',
    seed: '7',
    config: getDefaultBattleConfig(17),
    layout: getBattleLayout(3),
  }, b => {
    b.send({ type: 'start', now: 0 });
    b.send({ type: 'tap', now: 800, cell: wrongCell(b.state) });
    b.send({ type: 'tap', now: 1000, cell: answerCell(b.state) });
    b.tickTo(TIMER.CLEAR_WRONG_FLASH);
    b.tickTo(TIMER.UNLOCK_GRID);
    b.send({ type: 'tap', now: 5200, cell: answerCell(b.state) });
    b.tickTo(TIMER.NEXT_PROBLEM);
    // Wrong tap one second before the opponent's deadline: it solves mid-lock.
    b.send({ type: 'tap', now: timerAt(b.state, TIMER.OPPONENT_SOLVE) - 1000, cell: wrongCell(b.state, 1) });
    b.tickTo(TIMER.OPPONENT_SOLVE);
    b.tickTo(TIMER.NEXT_PROBLEM);
    b.send({ type: 'tap', now: b.state.problemStartedAt + 900, cell: answerCell(b.state) });
    // A late tick: the blank ends at its own deadline, not at the tick's `now`.
    b.send({ type: 'tick', now: b.state.problemStartedAt + 5000 });
  });
}

function opponentPacingScenario() {
  return transcript({
    name: 'opponent-pacing',
    description:
      'Opponent pace: a fast node, then served tunables (wider jitter, higher floor, shorter blanks and lock) and a ' +
      'server config that slows it (fresh delay, new shape), a wrong tap under the served lock, an aiLockout that ' +
      'stops it and restarts it with a FRESH full delay, a win of the race to ten by the opponent, and a retry ' +
      'during the final blank whose pending next-problem timer still fires.',
    seed: '18446744073709551615',
    config: getDefaultBattleConfig(41),
    layout: getBattleLayout(5),
  }, b => {
    b.send({ type: 'start', now: 0 });
    b.tickTo(TIMER.OPPONENT_SOLVE);
    b.tickTo(TIMER.NEXT_PROBLEM);
    const settings = {
      aiJitterFraction: 0.6, aiMinDelayMs: 4000, gridBlankMs: 300, gridBlankAiMs: 1200, gridLockMs: 2500, wrongFlashMs: 200,
    };
    b.send({ type: 'settingsLoaded', now: b.state.problemStartedAt + 300, settings });
    const config = { ops: ['add', 'mul'], range: [2, 9], aiSeconds: 6.5, shapeId: 'star' };
    b.send({ type: 'configLoaded', now: b.state.problemStartedAt + 400, config, layout: getLayoutForShape('star', 5) });
    b.send({ type: 'tap', now: b.state.problemStartedAt + 600, cell: wrongCell(b.state) });
    b.tickTo(TIMER.UNLOCK_GRID);
    b.send({ type: 'bondPower', now: b.state.problemStartedAt + 3500, power: { ...POWERS.aiLockout, durationMs: 5000 } });
    b.tickTo(TIMER.END_AI_LOCKOUT);
    b.tickTo(TIMER.OPPONENT_SOLVE);
    while (b.state.status === 'playing') {
      b.tickTo(TIMER.NEXT_PROBLEM);
      if (b.state.status === 'playing') b.tickTo(TIMER.OPPONENT_SOLVE);
    }
    const blankEnds = timerAt(b.state, TIMER.NEXT_PROBLEM);
    b.send({ type: 'retry', now: blankEnds - 1000 });
    b.tickTo(TIMER.NEXT_PROBLEM);
    b.send({ type: 'tap', now: b.state.problemStartedAt + 1500, cell: answerCell(b.state) });
  });
}

function bondPowersScenario() {
  return transcript({
    name: 'bond-powers',
    description:
      'Every Bond Power: mushrooms make covered cells inert, a power is refused while one is active and while on ' +
      'cooldown, the cooldown counts down in 100 ms steps (caught up by one late tick), the petal shield forgives ' +
      'exactly one wrong tap, lightning, the 2x2 peek and the answer reveal expire on their own timers.',
    seed: '2024',
    // A slow opponent, so it scores only where the script lets it.
    config: { ...getDefaultBattleConfig(30), aiSeconds: 40 },
    layout: getLayoutForShape('hexagon', 4),
  }, b => {
    b.send({ type: 'start', now: 0 });
    b.send({ type: 'bondPower', now: 300, power: POWERS.mushroomGrove });
    b.send({ type: 'tap', now: 600, cell: b.state.mushroomCellIndices[0] });
    b.send({ type: 'bondPower', now: 700, power: POWERS.lightningStrike });
    b.send({ type: 'tap', now: 900, cell: answerCell(b.state) });
    b.tickTo(TIMER.NEXT_PROBLEM);
    // Mushrooms cleared with the problem, but the cooldown still refuses.
    b.send({ type: 'bondPower', now: 1500, power: POWERS.petalShield });
    b.send({ type: 'tick', now: 20_000 });
    b.send({ type: 'bondPower', now: 20_300, power: POWERS.petalShield });
    b.send({ type: 'tap', now: 20_500, cell: wrongCell(b.state) });
    b.send({ type: 'tap', now: 20_700, cell: wrongCell(b.state, 1) });
    b.tickTo(TIMER.OPPONENT_SOLVE);
    b.tickTo(TIMER.NEXT_PROBLEM);
    b.send({ type: 'tick', now: 46_000 });
    b.send({ type: 'bondPower', now: 46_100, power: POWERS.lightningStrike });
    b.send({ type: 'tap', now: 46_200, cell: b.state.zappedCellIndices[0] });
    b.send({ type: 'tap', now: 46_400, cell: answerCell(b.state) });
    b.tickTo(TIMER.NEXT_PROBLEM);
    b.send({ type: 'tick', now: 72_000 });
    b.send({ type: 'bondPower', now: 72_100, power: POWERS.hint2x2 });
    b.tickTo(TIMER.CLEAR_HINT);
    b.send({ type: 'tick', now: 92_200 });
    b.send({ type: 'bondPower', now: 92_300, power: POWERS.revealAnswer });
    b.tickTo(TIMER.CLEAR_REVEAL);
  });
}

function hintFallbackScenario() {
  return transcript({
    name: 'hint-fallback',
    description:
      'hint2x2 on a layout where no 2x2 window holds three numbered cells: the answer cell plus two shuffled wrong cells.',
    seed: '99',
    config: getDefaultBattleConfig(12),
    layout: CHECKERBOARD,
  }, b => {
    b.send({ type: 'start', now: 0 });
    b.send({ type: 'bondPower', now: 500, power: POWERS.hint2x2 });
    b.send({ type: 'tap', now: 1500, cell: answerCell(b.state) });
    b.tickTo(TIMER.CLEAR_HINT);
  });
}

export function battleTranscriptsFixture() {
  return {
    fixture: 'battle-transcripts',
    version: 1,
    description:
      'Scripted battles through the battle reducer (src/rules/battle.js). Per transcript: rng = createSeededRandom(seed).next; ' +
      'initialState = createBattleState(init, rng); then for each step, stepBattle(previous state, step.event, rng) ' +
      'returns step.effects and step.state, all from the ONE generator in order. Times are ms on an arbitrary epoch.',
    transcripts: [
      winScenario(),
      lossScenario(),
      gridLockScenario(),
      opponentPacingScenario(),
      bondPowersScenario(),
      hintFallbackScenario(),
    ],
  };
}
