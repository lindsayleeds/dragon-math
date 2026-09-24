// Properties of the Dragon Munchers reducer that the golden transcripts cannot
// show on their own: that it is pure, that its state is plain data, that how
// often the clock is ticked does not change the outcome, and the individual
// rules pinned in isolation. Behaviour end to end is pinned by
// golden/munchers.json (golden.test.js) and, through the component, by
// src/components/DragonMunchers.test.jsx.

import { describe, it, expect, vi } from 'vitest';
import {
  GRID_COLS,
  START_CELL,
  TIMER,
  TOTAL_CELLS,
  createMunchersState,
  enemyInterval,
  generateBoard,
  getCorrectAnswers,
  isCorrectValue,
  maxEnemies,
  nextTimerAt,
  pickSpawnPosition,
  stepMunchers,
  totalCorrect,
} from './munchers.js';
import { munchersFixture } from './munchersTranscripts.js';
import { createSeededRandom } from './seededRandom.js';
import { DEFAULT_MUNCHERS_SETTINGS } from '../data/ruleSettings.js';

const {
  caughtBeatMs: CAUGHT_BEAT_MS,
  enemyTelegraphMs: ENEMY_TELEGRAPH_MS,
  spawnIntervalMs: SPAWN_INTERVAL_MS,
  startingLives: STARTING_LIVES,
} = DEFAULT_MUNCHERS_SETTINGS;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function newGame({ seed = 5, operation = 'mul', baseNumber = 3, progression = false, highScore = 0 } = {}) {
  const rng = createSeededRandom(seed).next;
  let state = createMunchersState({ operation, baseNumber, progression, highScore }, rng);
  const effects = [];
  const send = event => {
    const out = stepMunchers(state, event, rng);
    state = out.state;
    effects.push(...out.effects);
    return out;
  };
  return { rng, send, effects, get state() { return state; }, set state(s) { state = s; } };
}

const started = opts => {
  const g = newGame(opts);
  g.send({ type: 'start', now: 0 });
  return g;
};

const correctCell = s => s.board.findIndex((v, i) => isCorrectValue(s, v) && !s.eaten.includes(i));
const wrongCell = s => s.board.findIndex((v, i) => v !== null && !isCorrectValue(s, v) && !s.eaten.includes(i));
const kinds = s => s.timers.map(t => t.kind).sort();

describe('munchers reducer — purity', () => {
  it('never mutates the state it is given', () => {
    const g = started();
    let s = deepFreeze(g.state);
    const events = [
      { type: 'move', now: 100, direction: 'up' },
      { type: 'tapCell', now: 200, cell: START_CELL - GRID_COLS - 1 },
      { type: 'eat', now: 300 },
      { type: 'tick', now: 30_000 },
      { type: 'dismissWrongAnswer', now: 30_100 },
      { type: 'configChanged', now: 30_200, operation: 'add', baseNumber: 4, progression: true },
      { type: 'tick', now: 90_000 },
    ];
    for (const event of events) {
      expect(() => { s = deepFreeze(stepMunchers(s, event, g.rng).state); }).not.toThrow();
    }
    expect(s.gameOver).toBe(true);
  });

  it('returns the same state object for an event that changes nothing', () => {
    const g = started();
    const s = g.state;
    expect(stepMunchers(s, { type: 'tick', now: 10 }, g.rng).state).toBe(s);
    expect(stepMunchers(s, { type: 'move', now: 10, direction: 'down' }, g.rng).state).toBe(s); // bottom edge
    expect(stepMunchers(s, { type: 'dismissWrongAnswer', now: 10 }, g.rng).state).toBe(s);
    expect(stepMunchers(s, { type: 'advanceLevel', now: 10 }, g.rng).state).toBe(s);
    expect(stepMunchers(s, { type: 'tapCell', now: 10, cell: 0 }, g.rng).state).toBe(s);
    expect(stepMunchers(s, { type: 'start', now: 10 }, g.rng).state).toBe(s);
    const same = { type: 'configChanged', now: 10, operation: 'mul', baseNumber: 3, progression: false };
    expect(stepMunchers(s, same, g.rng).state).toBe(s);
  });

  it('keeps its state plain data', () => {
    const g = started();
    g.send({ type: 'tick', now: 20_000 });
    expect(JSON.parse(JSON.stringify(g.state))).toEqual(g.state);
  });

  it('reaches the same state from one late tick as from on-time ticks', () => {
    const play = (onTime) => {
      const g = started({ seed: 11, progression: true });
      if (onTime) {
        while (nextTimerAt(g.state) !== null && nextTimerAt(g.state) <= 50_000) {
          g.send({ type: 'tick', now: nextTimerAt(g.state) });
        }
      }
      g.send({ type: 'tick', now: 50_000 });
      return g;
    };
    const late = play(false);
    expect(late.state.lives).toBeLessThan(STARTING_LIVES);
    const onTime = play(true);
    expect(late.state).toEqual(onTime.state);
    expect(late.effects).toEqual(onTime.effects);
  });

  it('draws only from the injected rng, never Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      munchersFixture();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('throws on an unknown event', () => {
    const g = newGame();
    expect(() => g.send({ type: 'nope', now: 0 })).toThrow(/unknown munchers event/);
  });
});

describe('munchers reducer — the board', () => {
  it.each([['mul', 3], ['mul', 9], ['add', 4], ['sub', 9], ['div', 24]])(
    'deals every %s %i answer once and only non-answers as distractors',
    (operation, base) => {
      const rng = createSeededRandom(1).next;
      const board = generateBoard(operation, base, rng);
      expect(board).toHaveLength(TOTAL_CELLS);
      const answers = getCorrectAnswers(operation, base);
      for (const a of answers) expect(board.filter(v => v === a)).toHaveLength(1);
      const s = { operation, baseNumber: base, levels: [base], level: 0, board };
      expect(totalCorrect(s)).toBe(answers.length);
    },
  );

  it('plans progression levels as shuffled easy bases then shuffled hard ones', () => {
    const { state } = newGame({ progression: true, seed: 3 });
    expect([...state.levels.slice(0, 4)].sort()).toEqual([2, 3, 4, 5]);
    expect([...state.levels.slice(4)].sort()).toEqual([6, 7, 8, 9]);
  });
});

describe('munchers reducer — clocks', () => {
  it('runs no clock before start, then arms spawn and the monster pace', () => {
    const g = newGame();
    expect(g.state.timers).toEqual([]);
    g.send({ type: 'start', now: 1000 });
    expect(g.state.timers).toEqual([
      { id: 1, kind: TIMER.SPAWN, at: 1000 + SPAWN_INTERVAL_MS },
      { id: 2, kind: TIMER.ENEMY_PLAN, at: 1000 + enemyInterval(g.state) },
    ]);
  });

  it('speeds up and adds monsters with progress', () => {
    const settings = DEFAULT_MUNCHERS_SETTINGS;
    const at = level => ({ progression: true, level, settings });
    expect(enemyInterval(at(0))).toBe(3000);
    expect(enemyInterval(at(4))).toBe(2120);
    expect(enemyInterval(at(20))).toBe(1100);
    expect([0, 2, 3, 6, 9].map(l => maxEnemies(at(l)))).toEqual([1, 1, 2, 3, 3]);
    expect(maxEnemies({ progression: false, level: 7, settings })).toBe(1);
  });

  it('reads its tunables from the settings it was dealt', () => {
    const settings = {
      ...DEFAULT_MUNCHERS_SETTINGS,
      startingLives: 5,
      enemyMoveIntervalMs: 2000,
      enemySpeedupPerLevelMs: 100,
      minEnemyIntervalMs: 1500,
      levelsPerExtraEnemy: 1,
      maxEnemies: 4,
      progressionEasy: [3],
      progressionHard: [8, 9],
    };
    const s = createMunchersState({ operation: 'mul', baseNumber: 2, progression: true, settings }, createSeededRandom(4).next);
    expect(s.settings).toBe(settings);
    expect(s.lives).toBe(5);
    expect(s.levels[0]).toBe(3);
    expect([...s.levels.slice(1)].sort()).toEqual([8, 9]);
    expect([0, 3, 9].map(level => enemyInterval({ ...s, level }))).toEqual([2000, 1700, 1500]);
    expect([0, 1, 5].map(level => maxEnemies({ ...s, level }))).toEqual([1, 2, 4]);
    const started = stepMunchers(s, { type: 'start', now: 0 }, createSeededRandom(4).next).state;
    expect(started.timers.map(t => [t.kind, t.at])).toEqual([[TIMER.SPAWN, 4000], [TIMER.ENEMY_PLAN, 2000]]);
  });

  it('defaults to the web fallback settings', () => {
    const s = createMunchersState({ operation: 'mul', baseNumber: 2 }, createSeededRandom(1).next);
    expect(s.settings).toBe(DEFAULT_MUNCHERS_SETTINGS);
  });

  it('spawns never on or next to the muncher, nor on another monster', () => {
    const rng = createSeededRandom(2).next;
    for (let trial = 0; trial < 200; trial++) {
      const muncher = trial % TOTAL_CELLS;
      const occupied = [(muncher + 13) % TOTAL_CELLS];
      const pos = pickSpawnPosition(muncher, occupied, rng);
      const dr = Math.abs(Math.floor(pos / GRID_COLS) - Math.floor(muncher / GRID_COLS));
      const dc = Math.abs((pos % GRID_COLS) - (muncher % GRID_COLS));
      expect(Math.max(dr, dc)).toBeGreaterThan(1);
      expect(occupied).not.toContain(pos);
    }
  });

  it('telegraphs, then steps after the telegraph pause', () => {
    const g = started();
    g.send({ type: 'tick', now: SPAWN_INTERVAL_MS });
    expect(g.state.enemies).toHaveLength(1);
    const planAt = nextTimerAt(g.state);
    g.send({ type: 'tick', now: planAt });
    const [planned] = g.state.enemies;
    expect(planned.nextPosition).not.toBe(planned.position);
    expect(planned.facing).not.toBe('center');
    g.send({ type: 'tick', now: planAt + ENEMY_TELEGRAPH_MS });
    expect(g.state.enemies[0]).toMatchObject({ position: planned.nextPosition, facing: 'center' });
  });

  it('never lets two monsters stack: a monster will not step onto one staying put', () => {
    const g = started();
    // Two monsters in a column above the muncher's column; rng always chases.
    g.state = {
      ...g.state,
      muncher: 24,
      enemies: [
        { id: 0, position: 14, facing: 'center', nextPosition: null },
        { id: 1, position: 4, facing: 'center', nextPosition: null },
      ],
    };
    const chase = () => 0;
    const at = g.state.timers.find(t => t.kind === TIMER.ENEMY_PLAN).at;
    const { state } = stepMunchers(g.state, { type: 'tick', now: at }, chase);
    // Both step toward the muncher; neither target is anyone's settled cell.
    expect(state.enemies.map(e => e.nextPosition)).toEqual([19, 9]);
    // Rear monster first: its target is the front monster's cell, which is
    // still settled there when it is resolved, so it holds.
    const blocked = stepMunchers({
      ...g.state,
      enemies: [
        { id: 0, position: 9, facing: 'center', nextPosition: null },
        { id: 1, position: 14, facing: 'center', nextPosition: null },
      ],
      muncher: 19,
    }, { type: 'tick', now: at }, chase).state;
    // Monster 0 wants 14, still held by monster 1 → holds, facing center.
    // Monster 1 steps onto the muncher's cell.
    expect(blocked.enemies[0]).toMatchObject({ nextPosition: 9, facing: 'center' });
    expect(blocked.enemies[1]).toMatchObject({ nextPosition: 19, facing: 'down' });
  });
});

describe('munchers reducer — collisions and lives', () => {
  it('catches the muncher when it walks onto a monster, freezing play for the gobble beat', () => {
    const g = started();
    g.state = { ...g.state, enemies: [{ id: 0, position: START_CELL - 1, facing: 'center', nextPosition: null }] };
    const out = g.send({ type: 'move', now: 500, direction: 'left' });
    expect(out.effects).toEqual([{ type: 'sound', sound: 'caught' }]);
    expect(g.state.caughtAt).toBe(START_CELL - 1);
    expect(kinds(g.state)).toEqual([TIMER.CAUGHT_END]);

    // Frozen: no eating, no cell taps; the arrow buttons still move it.
    expect(stepMunchers(g.state, { type: 'eat', now: 600 }, g.rng).state).toBe(g.state);
    expect(stepMunchers(g.state, { type: 'tapCell', now: 600, cell: START_CELL - 2 }, g.rng).state).toBe(g.state);
    g.send({ type: 'move', now: 700, direction: 'up' });
    expect(g.state.muncher).toBe(START_CELL - 1 - GRID_COLS);

    g.send({ type: 'tick', now: 500 + CAUGHT_BEAT_MS });
    expect(g.state).toMatchObject({ lives: STARTING_LIVES - 1, muncher: START_CELL, caughtAt: null, enemies: [] });
    expect(kinds(g.state)).toEqual([TIMER.ENEMY_PLAN, TIMER.SPAWN]);
  });

  it('ends the game on the last life, banking a new high score once', () => {
    const g = started({ highScore: 0 });
    g.state = { ...g.state, lives: 1, score: 15 };
    g.state = { ...g.state, enemies: [{ id: 0, position: START_CELL - 1, facing: 'center', nextPosition: null }] };
    g.send({ type: 'move', now: 0, direction: 'left' });
    const out = g.send({ type: 'tick', now: CAUGHT_BEAT_MS });
    expect(out.effects).toEqual([{ type: 'saveHighScore', score: 15 }, { type: 'gameOver', score: 15 }]);
    expect(g.state).toMatchObject({ gameOver: true, isNewHighScore: true, highScore: 15, timers: [] });
    expect(stepMunchers(g.state, { type: 'move', now: 2000, direction: 'up' }, g.rng).state).toBe(g.state);
  });

  it('lets the wrong-answer message stand without freezing, and charges a life on dismissal', () => {
    const g = started();
    const target = wrongCell(g.state);
    g.state = { ...g.state, muncher: target };
    const out = g.send({ type: 'eat', now: 100 });
    expect(out.effects).toEqual([{ type: 'sound', sound: 'wrong' }]);
    expect(g.state.wrongAnswer).toEqual({ operation: 'mul', baseNumber: 3, value: g.state.board[target] });
    expect(g.state.lives).toBe(STARTING_LIVES);
    expect(kinds(g.state)).toEqual([TIMER.ENEMY_PLAN, TIMER.SPAWN]);
    g.send({ type: 'dismissWrongAnswer', now: 200 });
    expect(g.state).toMatchObject({ wrongAnswer: null, lives: STARTING_LIVES - 1 });
  });
});

describe('munchers reducer — scoring and levels', () => {
  it('scores by base, one baby dragon per bite, and never twice for a cell', () => {
    const g = started({ baseNumber: 7 });
    g.state = { ...g.state, muncher: correctCell(g.state) };
    g.send({ type: 'eat', now: 100 });
    expect(g.state).toMatchObject({ score: 10, correctEaten: 1 });
    expect(g.state.babyDragons).toEqual([{ id: '0-1', emoji: expect.any(String) }]);
    expect(stepMunchers(g.state, { type: 'eat', now: 200 }, g.rng).state).toBe(g.state);
  });

  it('shows the level splash on a cleared board, then deals the next base with lives and score kept', () => {
    const g = started({ progression: true });
    for (let n = totalCorrect(g.state); n > 0; n--) {
      g.state = { ...g.state, muncher: correctCell(g.state) };
      g.send({ type: 'eat', now: 100 });
    }
    expect(g.state.levelTransition).toBe(true);
    expect(g.state.timers).toEqual([]);
    const { score, lives, levels } = g.state;
    g.send({ type: 'advanceLevel', now: 5000 });
    expect(g.state).toMatchObject({
      level: 1, levelTransition: false, score, lives, eaten: [], correctEaten: 0, babyDragons: [], muncher: START_CELL,
    });
    expect(totalCorrect(g.state)).toBe(getCorrectAnswers('mul', levels[1]).length);
    expect(nextTimerAt(g.state)).toBe(5000 + enemyInterval(g.state));
  });

  it('re-deals on a new base but keeps the rest of the run', () => {
    const g = started();
    g.state = { ...g.state, muncher: correctCell(g.state) };
    g.send({ type: 'eat', now: 100 });
    const before = g.state;
    g.send({ type: 'configChanged', now: 200, operation: 'mul', baseNumber: 5, progression: false });
    expect(g.state.board).not.toEqual(before.board);
    expect(g.state).toMatchObject({ score: before.score, eaten: before.eaten, muncher: before.muncher, levels: [5] });
  });
});
