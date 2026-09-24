// The pure plausibility checks (no db). The db helpers and the exclusion from
// shared views are exercised against a real Postgres in
// server/routes/plausibility.pg.test.js.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as munchers from '../../src/rules/munchers.js';
import { DEFAULT_MUNCHERS_SETTINGS } from '../../src/data/ruleSettings.js';
import { PROBLEMS_TO_WIN } from '../../src/data/battleData.js';

const require = createRequire(import.meta.url);
const {
  PLAUSIBILITY,
  REASONS,
  clockReasons,
  minMatchDurationMs,
  matchReasons,
  dragonReasons,
  nodeWinReasons,
  gameScoreReasons,
} = require('./plausibility');
const { BATTLE_SETTINGS } = require('./ruleSettings');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

describe('clockReasons', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');

  it('accepts a clock a little ahead, and an offline queue weeks old', () => {
    expect(clockReasons(now + 5 * MIN, now)).toEqual([]);
    expect(clockReasons(now - 30 * DAY, now)).toEqual([]);
  });

  it('flags a clock far ahead or far behind', () => {
    expect(clockReasons(now + PLAUSIBILITY.CLOCK_AHEAD_TOLERANCE_MS + 1, now)).toEqual([REASONS.CLOCK_AHEAD]);
    expect(clockReasons(now - PLAUSIBILITY.MAX_EVENT_AGE_MS - 1, now)).toEqual([REASONS.CLOCK_BEHIND]);
  });
});

describe('minMatchDurationMs', () => {
  it('reads the opponent floor and the blank beats from rule settings', () => {
    const { opponent, timings } = BATTLE_SETTINGS;
    // Kid wins 10–0: ten solves, nine beats between them.
    expect(minMatchDurationMs({ playerScore: 10, aiScore: 0 }))
      .toBe(10 * PLAUSIBILITY.MIN_CHILD_SOLVE_MS + 9 * timings.grid_blank_ms);
    // Opponent wins 0–10.
    expect(minMatchDurationMs({ playerScore: 0, aiScore: 10 }))
      .toBe(10 * opponent.min_delay_ms + 9 * timings.grid_blank_ai_ms);
    expect(minMatchDurationMs({ playerScore: 0, aiScore: 0 })).toBe(0);
  });

  it('follows a change to the served timings', () => {
    const slower = { ...BATTLE_SETTINGS, timings: { ...BATTLE_SETTINGS.timings, grid_blank_ms: 1000 } };
    expect(minMatchDurationMs({ playerScore: 2, aiScore: 0 }, slower)).toBe(2 * PLAUSIBILITY.MIN_CHILD_SOLVE_MS + 1000);
  });
});

describe('matchReasons', () => {
  const start = new Date('2026-09-24T12:00:00Z');
  const after = ms => new Date(start.getTime() + ms);
  const win = { playerScore: PROBLEMS_TO_WIN, aiScore: 4 };

  it('accepts a quick but humanly possible battle', () => {
    expect(matchReasons({ ...win, startedAt: start, endedAt: after(45_000) })).toEqual([]);
  });

  it('flags a battle shorter than its score allows', () => {
    expect(matchReasons({ ...win, startedAt: start, endedAt: after(3_000) })).toEqual([REASONS.MATCH_TOO_FAST]);
  });

  it('flags an end before the start', () => {
    expect(matchReasons({ ...win, startedAt: start, endedAt: after(-1) })).toEqual([REASONS.MATCH_ENDS_BEFORE_START]);
  });

  it('never flags an abandoned battle with nothing scored', () => {
    expect(matchReasons({ playerScore: 0, aiScore: 0, startedAt: start, endedAt: start })).toEqual([]);
  });
});

describe('reward rates', () => {
  const quiet = { before: 3, after: 3 };

  it('flags more dragons in one event than any game awards', () => {
    expect(dragonReasons(PLAUSIBILITY.MAX_DRAGONS_PER_EVENT, quiet)).toEqual([]);
    expect(dragonReasons(PLAUSIBILITY.MAX_DRAGONS_PER_EVENT + 1, quiet)).toEqual([REASONS.DRAGON_BURST]);
  });

  it('flags too many dragons either side of an event', () => {
    const max = PLAUSIBILITY.MAX_DRAGONS_PER_WINDOW;
    expect(dragonReasons(3, { before: max, after: max })).toEqual([]);
    expect(dragonReasons(3, { before: max + 1, after: 3 })).toEqual([REASONS.DRAGON_RATE]);
    expect(dragonReasons(3, { before: 3, after: max + 1 })).toEqual([REASONS.DRAGON_RATE]);
  });

  it('flags too many node wins either side of an event', () => {
    const max = PLAUSIBILITY.MAX_NODE_WINS_PER_WINDOW;
    expect(nodeWinReasons({ before: max, after: 1 })).toEqual([]);
    expect(nodeWinReasons({ before: 1, after: max + 1 })).toEqual([REASONS.NODE_WIN_RATE]);
  });
});

describe('gameScoreReasons', () => {
  it('holds the Munchers ceiling to what the rules can award', () => {
    const { getCorrectAnswers, pointsForBase } = munchers;
    const { progressionEasy, progressionHard } = DEFAULT_MUNCHERS_SETTINGS;
    const ops = ['add', 'sub', 'mul', 'div'];
    const best = base => Math.max(...ops.map(op => getCorrectAnswers(op, base).length)) * pointsForBase(base);
    const campaign = [...progressionEasy, ...progressionHard].reduce((sum, base) => sum + best(base), 0);
    const singleBase = Math.max(...Array.from({ length: 100 }, (_, i) => best(i + 1)));
    expect(PLAUSIBILITY.MUNCHERS_MAX_SCORE).toBe(Math.max(campaign, singleBase));
  });

  it('flags only a score above the ceiling, and only for a game with one', () => {
    expect(gameScoreReasons('dragon-munchers', PLAUSIBILITY.MUNCHERS_MAX_SCORE)).toEqual([]);
    expect(gameScoreReasons('dragon-munchers', PLAUSIBILITY.MUNCHERS_MAX_SCORE + 5)).toEqual([REASONS.SCORE_ABOVE_MAX]);
    expect(gameScoreReasons('some-other-game', 999_999)).toEqual([]);
  });
});
