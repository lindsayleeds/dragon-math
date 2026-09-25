// The game pace (src/rules/pace.js) as an input to the battle and Munchers
// reducers: slow stretches exactly the race clocks, off stops them. End to end
// it is pinned by the slow-pace and untimed transcripts in
// golden/battle-transcripts.json and golden/munchers.json.

import { describe, it, expect } from 'vitest';
import { getBattleLayout, getDefaultBattleConfig, PROBLEMS_TO_WIN } from '../data/battleData.js';
import { DEFAULT_BATTLE_SETTINGS } from '../data/battleSettings.js';
import { DEFAULT_MUNCHERS_SETTINGS } from '../data/ruleSettings.js';
import { createBattleState, stepBattle, TIMER as BATTLE_TIMER } from './battle.js';
import {
  createMunchersState,
  enemyInterval,
  spawnInterval,
  stepMunchers,
  telegraphMs,
  TIMER as MUNCHERS_TIMER,
} from './munchers.js';
import { isUntimed, normalizePace, PACE, PACES, paceFactor, SLOW_PACE_FACTOR } from './pace.js';
import { createSeededRandom } from './seededRandom.js';

const timerAt = (s, kind) => s.timers.find(t => t.kind === kind)?.at ?? null;
const answerCell = s => s.grid.indexOf(s.problem.answer);

describe('pace', () => {
  it('has three values, and reads anything else as normal', () => {
    expect(PACES).toEqual(['normal', 'slow', 'off']);
    for (const pace of [undefined, null, '', 'fast', 'SLOW']) expect(normalizePace(pace)).toBe('normal');
    expect(paceFactor('slow')).toBe(SLOW_PACE_FACTOR);
    expect(paceFactor('normal')).toBe(1);
    expect(paceFactor('bogus')).toBe(1);
    expect(isUntimed('off')).toBe(true);
    expect(isUntimed('slow')).toBe(false);
  });
});

describe('battle pace', () => {
  const config = getDefaultBattleConfig(9);
  const start = pace => {
    // A constant rng, so the jitter draw is the same at every pace.
    const rng = () => 0.75;
    const state = createBattleState({ config, layout: getBattleLayout(2), pace }, rng);
    return { rng, state: stepBattle(state, { type: 'start', now: 0 }, rng).state };
  };

  it('defaults to normal, keeps it on the state, and normalizes unknown values', () => {
    const rng = createSeededRandom(1).next;
    expect(createBattleState({ config, layout: getBattleLayout(2) }, rng).pace).toBe('normal');
    expect(createBattleState({ config, layout: getBattleLayout(2), pace: 'warp' }, rng).pace).toBe('normal');
  });

  it('slow draws the opponent delay from a base SLOW_PACE_FACTOR times longer', () => {
    const { aiJitterFraction } = DEFAULT_BATTLE_SETTINGS;
    const delay = base => Math.max(DEFAULT_BATTLE_SETTINGS.aiMinDelayMs, base + base * aiJitterFraction * 0.25);
    expect(timerAt(start(PACE.NORMAL).state, BATTLE_TIMER.OPPONENT_SOLVE)).toBe(delay(config.aiSeconds * 1000));
    expect(timerAt(start(PACE.SLOW).state, BATTLE_TIMER.OPPONENT_SOLVE))
      .toBe(delay(config.aiSeconds * 1000 * SLOW_PACE_FACTOR));
  });

  it('slow leaves the blanks, the flash and the grid lock alone', () => {
    const { rng, state } = start(PACE.SLOW);
    const wrong = state.grid.findIndex(v => v !== null && v !== state.problem.answer);
    const locked = stepBattle(state, { type: 'tap', now: 100, cell: wrong }, rng).state;
    expect(timerAt(locked, BATTLE_TIMER.UNLOCK_GRID)).toBe(100 + DEFAULT_BATTLE_SETTINGS.gridLockMs);
    expect(timerAt(locked, BATTLE_TIMER.CLEAR_WRONG_FLASH)).toBe(100 + DEFAULT_BATTLE_SETTINGS.wrongFlashMs);
    const solved = stepBattle(state, { type: 'tap', now: 100, cell: answerCell(state) }, rng).state;
    expect(timerAt(solved, BATTLE_TIMER.NEXT_PROBLEM)).toBe(100 + DEFAULT_BATTLE_SETTINGS.gridBlankMs);
  });

  it('off never schedules the opponent nor draws for it, and the child can still win', () => {
    let draws = 0;
    const seeded = createSeededRandom(3).next;
    const rng = () => { draws += 1; return seeded(); };
    let s = createBattleState({ config, layout: getBattleLayout(2), pace: PACE.OFF }, rng);
    const dealDraws = draws;
    s = stepBattle(s, { type: 'start', now: 0 }, rng).state;
    expect(draws).toBe(dealDraws);
    expect(timerAt(s, BATTLE_TIMER.OPPONENT_SOLVE)).toBeNull();
    s = stepBattle(s, { type: 'tick', now: 3_600_000 }, rng).state;
    expect(s.aiScore).toBe(0);
    let now = 3_600_000;
    while (s.status === 'playing') {
      s = stepBattle(s, { type: 'tap', now: (now += 100), cell: answerCell(s) }, rng).state;
      s = stepBattle(s, { type: 'tick', now: (now += 5000) }, rng).state;
      expect(timerAt(s, BATTLE_TIMER.OPPONENT_SOLVE)).toBeNull();
    }
    expect(s.status).toBe('won');
    expect(s.playerScore).toBe(PROBLEMS_TO_WIN);
    expect(stepBattle(s, { type: 'retry', now }, rng).state.pace).toBe('off');
  });
});

describe('munchers pace', () => {
  const game = (pace, progression = false) => {
    const rng = createSeededRandom(9).next;
    const state = createMunchersState({ operation: 'mul', baseNumber: 3, progression, pace }, rng);
    return { rng, state };
  };

  it('defaults to normal and keeps it on the state', () => {
    const rng = createSeededRandom(1).next;
    expect(createMunchersState({ operation: 'mul', baseNumber: 3 }, rng).pace).toBe('normal');
    expect(game(PACE.SLOW).state.pace).toBe('slow');
  });

  it('slow stretches the spawn, step and telegraph clocks but not the gobble beat', () => {
    const normal = game(PACE.NORMAL).state;
    const slow = game(PACE.SLOW).state;
    expect(spawnInterval(slow)).toBe(DEFAULT_MUNCHERS_SETTINGS.spawnIntervalMs * SLOW_PACE_FACTOR);
    expect(enemyInterval(slow)).toBe(enemyInterval(normal) * SLOW_PACE_FACTOR);
    expect(telegraphMs(slow)).toBe(DEFAULT_MUNCHERS_SETTINGS.enemyTelegraphMs * SLOW_PACE_FACTOR);
    // In the campaign too, after the speed-up and its floor.
    const campaign = { ...game(PACE.SLOW, true).state, level: 40 };
    expect(enemyInterval(campaign)).toBe(DEFAULT_MUNCHERS_SETTINGS.minEnemyIntervalMs * SLOW_PACE_FACTOR);

    const { rng } = game(PACE.SLOW);
    let s = stepMunchers(slow, { type: 'start', now: 0 }, rng).state;
    expect(timerAt(s, MUNCHERS_TIMER.SPAWN)).toBe(spawnInterval(slow));
    expect(timerAt(s, MUNCHERS_TIMER.ENEMY_PLAN)).toBe(enemyInterval(slow));
    s = stepMunchers(s, { type: 'tick', now: enemyInterval(slow) }, rng).state;
    expect(timerAt(s, MUNCHERS_TIMER.ENEMY_COMMIT)).toBe(enemyInterval(slow) + telegraphMs(slow));
    // Catch: the beat keeps its served length.
    let caughtTick = 0;
    while (s.caughtAt === null) {
      caughtTick = Math.min(...s.timers.map(t => t.at));
      s = stepMunchers(s, { type: 'tick', now: caughtTick }, rng).state;
    }
    expect(s.timers).toEqual([
      expect.objectContaining({ kind: MUNCHERS_TIMER.CAUGHT_END, at: caughtTick + DEFAULT_MUNCHERS_SETTINGS.caughtBeatMs }),
    ]);
  });

  it('off never arms a monster clock, so no monster ever appears', () => {
    const { rng, state } = game(PACE.OFF);
    let s = stepMunchers(state, { type: 'start', now: 0 }, rng).state;
    expect(s.timers).toEqual([]);
    const later = stepMunchers(s, { type: 'tick', now: 3_600_000 }, rng);
    expect(later.state).toBe(s);
    expect(s.enemies).toEqual([]);
    // The game still plays: moves and bites work.
    s = stepMunchers(s, { type: 'move', now: 10, direction: 'up' }, rng).state;
    expect(s.muncher).toBe(state.muncher - 5);
    expect(s.timers).toEqual([]);
  });
});

describe('the server contract', () => {
  it('offers exactly the rules\' paces', async () => {
    const { GAME_PACES } = await import('../../server/contracts/children.js');
    expect(GAME_PACES).toEqual([...PACES]);
  });
});
