// The munchers golden fixture: scripted games run through the pure Dragon
// Munchers reducer (src/rules/munchers.js) from fixed seeds, recording every
// input event with the effects and full state it produced. The Swift port
// replays each transcript's step events from `initialState` with the same seed
// and must match every step's effects and state exactly.
//
// The scenarios decide their moves by looking at the JavaScript state (e.g.
// "walk to the nearest correct answer"), but what is recorded is the literal
// event, so a replay needs no scenario logic.

import {
  GRID_COLS,
  createMunchersState,
  isCorrectValue,
  maxEnemies,
  nextTimerAt,
  SPAWN_INTERVAL_MS,
  stepMunchers,
  TIMER,
} from './munchers.js';
import { createSeededRandom } from './seededRandom.js';

// Guard against a scenario that never reaches its end.
const MAX_STEPS = 2000;

function transcript({ name, description, seed, init }, script) {
  const rng = createSeededRandom(BigInt(seed)).next;
  const initialState = createMunchersState(init, rng);
  let state = initialState;
  const steps = [];
  const send = event => {
    if (steps.length >= MAX_STEPS) throw new Error(`${name}: too many steps`);
    const out = stepMunchers(state, event, rng);
    state = out.state;
    steps.push({ event, effects: out.effects, state });
    return state;
  };
  const game = {
    send,
    get state() { return state; },
    // Tick to the earliest timer of `kind` (or the earliest of any kind).
    tickTo: kind => {
      const due = state.timers.filter(t => !kind || t.kind === kind).map(t => t.at);
      if (due.length === 0) throw new Error(`${name}: no ${kind ?? 'timer'} pending`);
      return send({ type: 'tick', now: Math.min(...due) });
    },
    // Walk the muncher to `target` one orthogonal step at a time (columns
    // first), sending each move `gap` ms after the last. Returns the new time.
    walkTo: (target, now, gap, type = 'move') => {
      let t = now;
      while (state.muncher !== target) {
        const cur = state.muncher;
        const dc = (target % GRID_COLS) - (cur % GRID_COLS);
        const dr = Math.floor(target / GRID_COLS) - Math.floor(cur / GRID_COLS);
        let direction;
        if (dc < 0) direction = 'left';
        else if (dc > 0) direction = 'right';
        else if (dr < 0) direction = 'up';
        else direction = 'down';
        t += gap;
        if (type === 'tapCell') {
          const cell = { left: cur - 1, right: cur + 1, up: cur - GRID_COLS, down: cur + GRID_COLS }[direction];
          send({ type: 'tapCell', now: t, cell });
        } else {
          send({ type: 'move', now: t, direction });
        }
      }
      return t;
    },
  };
  script(game);
  return { name, description, seed, init, initialState, steps };
}

const distance = (a, b) =>
  Math.abs((a % GRID_COLS) - (b % GRID_COLS)) + Math.abs(Math.floor(a / GRID_COLS) - Math.floor(b / GRID_COLS));

// The nearest uneaten cell matching `isCorrect`, ties to the lower index.
function nearestCell(s, isCorrect) {
  let best = -1;
  s.board.forEach((value, i) => {
    if (value === null || isCorrectValue(s, value) !== isCorrect || s.eaten.includes(i)) return;
    if (best === -1 || distance(s.muncher, i) < distance(s.muncher, best)) best = i;
  });
  return best;
}

// Eat every correct answer on the board, nearest first. Returns the new time.
function clearBoard(g, now, gap) {
  let t = now;
  for (;;) {
    const target = nearestCell(g.state, true);
    if (target === -1 || g.state.levelTransition || g.state.gameOver) return t;
    t = g.walkTo(target, t, gap);
    t += gap;
    g.send({ type: 'eat', now: t });
  }
}

// Stand still and let the clock run until nothing is pending.
function runClock(g) {
  while (nextTimerAt(g.state) !== null) g.tickTo();
}

function caughtScenario() {
  return transcript({
    name: 'caught-three-times',
    description:
      'The child never moves: monsters spawn away from the muncher, telegraph and step toward it, and catch it ' +
      'three times; each catch is a gobble beat, a lost life and a reset; the third ends the game.',
    seed: '3',
    init: { operation: 'mul', baseNumber: 3, progression: false, highScore: 0 },
  }, g => {
    g.send({ type: 'start', now: 0 });
    runClock(g);
  });
}

function walkIntoMonsterScenario() {
  return transcript({
    name: 'walk-into-monster',
    description:
      'The child walks onto a monster that has not moved yet: caught on the step. During the gobble beat the ' +
      'arrow buttons still move the muncher but eat and cell taps are refused; the beat ends with a reset.',
    seed: '8',
    init: { operation: 'add', baseNumber: 4, progression: false, highScore: 0 },
  }, g => {
    g.send({ type: 'start', now: 0 });
    g.tickTo(TIMER.SPAWN);
    const monster = g.state.enemies[0].position;
    g.walkTo(monster, SPAWN_INTERVAL_MS, 100);
    const t = g.state.timers.find(t => t.kind === TIMER.CAUGHT_END).at;
    g.send({ type: 'eat', now: t - 800 });
    g.send({ type: 'tapCell', now: t - 700, cell: g.state.muncher - 1 });
    g.send({ type: 'move', now: t - 600, direction: 'left' });
    g.tickTo(TIMER.CAUGHT_END);
    // Play resumes: fresh spawn and move clocks from the end of the beat.
    g.tickTo(TIMER.SPAWN);
  });
}

function clearRoundScenario() {
  return transcript({
    name: 'clear-the-round',
    description:
      'A wrong bite shows its message without freezing play; moving still works under it; dismissing costs a ' +
      'life; a second bite on an eaten cell does nothing; eating every correct answer wins on a new high score.',
    seed: '21',
    init: { operation: 'mul', baseNumber: 3, progression: false, highScore: 20 },
  }, g => {
    let t = 0;
    g.send({ type: 'start', now: t });
    t = g.walkTo(nearestCell(g.state, false), t, 20, 'tapCell');
    t += 20;
    g.send({ type: 'tapCell', now: t, cell: g.state.muncher });
    g.send({ type: 'eat', now: (t += 20) });
    g.send({ type: 'move', now: (t += 20), direction: g.state.muncher % GRID_COLS === 0 ? 'right' : 'left' });
    g.send({ type: 'dismissWrongAnswer', now: (t += 20) });
    g.send({ type: 'dismissWrongAnswer', now: (t += 20) });
    clearBoard(g, t, 20);
  });
}

function wrongAnswersScenario() {
  return transcript({
    name: 'wrong-answers',
    description: 'Three wrong bites, each dismissed for a life: the third dismissal ends the game with no high score.',
    seed: '5',
    init: { operation: 'sub', baseNumber: 9, progression: false, highScore: 0 },
  }, g => {
    let t = 0;
    g.send({ type: 'start', now: t });
    while (!g.state.gameOver) {
      t = g.walkTo(nearestCell(g.state, false), t, 25);
      g.send({ type: 'eat', now: (t += 25) });
      g.send({ type: 'dismissWrongAnswer', now: (t += 25) });
    }
  });
}

function progressionScenario() {
  return transcript({
    name: 'progression',
    description:
      'The campaign: levels in shuffled order, a splash between levels (frozen, no monsters), each level on a ' +
      'fresh board worth its points. From level four two monsters hunt at a faster pace, resolving conflicting ' +
      'steps, until they catch the idle muncher three times.',
    seed: '77',
    init: { operation: 'mul', baseNumber: 2, progression: true, highScore: 0 },
  }, g => {
    let t = 0;
    g.send({ type: 'start', now: t });
    for (let level = 0; level < 3; level++) {
      t = clearBoard(g, t, 10);
      // The splash freezes play: the clocks stop.
      g.send({ type: 'tick', now: (t += 5000) });
      g.send({ type: 'advanceLevel', now: (t += 10) });
    }
    if (maxEnemies(g.state) !== 2) throw new Error('progression: level four should allow two monsters');
    runClock(g);
  });
}

function lateTickScenario() {
  return transcript({
    name: 'late-tick',
    description:
      'One tick long after the start fires every timer that fell due, in order, each at its own time: ' +
      'spawns, plans, commits, catches, gobble beats and resets, exactly as on-time ticks would.',
    seed: '12',
    init: { operation: 'div', baseNumber: 24, progression: false, highScore: 0 },
  }, g => {
    g.send({ type: 'start', now: 1_000 });
    g.send({ type: 'tick', now: 60_000 });
  });
}

function configChangedScenario() {
  return transcript({
    name: 'config-changed',
    description:
      'New props mid-game: an unchanged config is ignored; a new base re-deals the board but keeps the score, ' +
      'the eaten cells and the muncher; switching to the campaign plans its levels and re-deals for the first ' +
      "level's base, while the monster clocks keep running (the pace and room are unchanged at level one).",
    seed: '31',
    init: { operation: 'mul', baseNumber: 6, progression: false, highScore: 0 },
  }, g => {
    g.send({ type: 'start', now: 0 });
    let t = g.walkTo(nearestCell(g.state, true), 0, 50);
    g.send({ type: 'eat', now: (t += 50) });
    g.send({ type: 'configChanged', now: (t += 50), operation: 'mul', baseNumber: 6, progression: false });
    g.send({ type: 'configChanged', now: (t += 50), operation: 'mul', baseNumber: 7, progression: false });
    g.send({ type: 'configChanged', now: t + 50, operation: 'add', baseNumber: 7, progression: false });
    g.tickTo(TIMER.SPAWN);
    const spawnAt = g.state.timers.find(x => x.kind === TIMER.SPAWN).at;
    g.send({ type: 'configChanged', now: spawnAt - 1000, operation: 'add', baseNumber: 7, progression: true });
    g.tickTo();
    g.tickTo();
  });
}

export function munchersFixture() {
  return {
    fixture: 'munchers',
    version: 1,
    description:
      'Scripted games through the Dragon Munchers reducer (src/rules/munchers.js). Per transcript: ' +
      'rng = createSeededRandom(seed).next; initialState = createMunchersState(init, rng); then for each step, ' +
      'stepMunchers(previous state, step.event, rng) returns step.effects and step.state, all from the ONE ' +
      'generator in order. Times are ms on an arbitrary epoch.',
    transcripts: [
      caughtScenario(),
      walkIntoMonsterScenario(),
      clearRoundScenario(),
      wrongAnswersScenario(),
      progressionScenario(),
      lateTickScenario(),
      configChangedScenario(),
    ],
  };
}
