// Characterisation tests for the battle loop.
//
// useBattle carries 9 of the react-hooks findings (6 refs, 2 purity, 1
// set-state-in-effect). The refs are all render-phase writes — configRef,
// problemRef, layoutRef, gridRef, playerScoreRef, aiScoreRef — and each one
// feeds a callback that fires LATER: the AI's setTimeout, the post-blank problem
// swap, and the unmount handler that reports an abandoned match. Those are
// precisely the places where a stale read is invisible in the UI but wrong in
// the data: the opponent gobbles the wrong cell, a problem is generated from the
// pre-server config, or an abandoned match is logged with the wrong score.
//
// So the tests below assert on those late-firing consequences, not on the refs
// themselves. Any refactor that keeps the contract keeps them green.
//
// Only randomness and I/O are mocked. battleData is PARTIALLY mocked
// (importOriginal) so the real PROBLEMS_TO_WIN, node configs, layouts and
// server-row parsing still run — only problem/grid generation is pinned, with
// the answer always at the first active cell.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBattle } from './useBattle';
import { api } from '../api';

const state = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../data/battleData', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateProblem: (config) => {
      const op = config.ops[0];
      state.counter += 1;
      const a = state.counter;
      const b = 2;
      const answer = op === 'add' ? a + b
        : op === 'sub' ? a - b
          : op === 'mul' ? a * b
            : a;
      return { a, b, op, text: `${a} ${op} ${b}`, answer };
    },
    // Answer at the first ACTIVE cell; every other active cell gets a distinct
    // value that can never collide with it.
    buildGridFromLayout: (answer, _config, layout) => {
      let n = 0;
      return layout.cells.map((active) => {
        if (!active) return null;
        n += 1;
        return n === 1 ? answer : answer + n * 1000;
      });
    },
  };
});

vi.mock('../api', () => ({
  api: {
    get: vi.fn(() => new Promise(() => {})),   // never resolves unless a test overrides
    post: vi.fn(() => Promise.resolve({ id: 'match-1' })),
    put: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('../utils/sounds', () => ({
  playYip: vi.fn(),
  playGrowl: vi.fn(),
  playVictory: vi.fn(),
  playDefeat: vi.fn(),
}));

const NODE_ID = 1;              // World 1: ops ['add'], aiSeconds 10
const AI_DELAY_MS = 10_000;     // aiSeconds * 1000, with jitter pinned to zero
const BLANK_MS = 500;
const BLANK_MS_AI = 2000;
const LOCK_MS = 4000;

const answerCellOf = (grid) => grid.findIndex(v => v !== null);
const wrongCellOf = (grid) => grid.findIndex((v, i) => v !== null && i !== answerCellOf(grid));

function postsTo(path) {
  return api.post.mock.calls.filter(([p]) => p === path);
}

beforeEach(() => {
  state.counter = 0;
  vi.useFakeTimers();
  // Pin the AI's ±17.5% jitter and every shuffle to the midpoint.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  api.get.mockImplementation(() => new Promise(() => {}));
  api.post.mockImplementation(() => Promise.resolve({ id: 'match-1' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function tapCorrect(result) {
  await act(async () => { result.current.handleCellTap(answerCellOf(result.current.grid)); });
  await act(async () => { vi.advanceTimersByTime(BLANK_MS); });
}

async function tapWrong(result) {
  await act(async () => { result.current.handleCellTap(wrongCellOf(result.current.grid)); });
}

// Let the AI's timer fire and the post-solve animation finish.
async function letAiSolve(result) {
  await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS); });
  await act(async () => { vi.advanceTimersByTime(BLANK_MS_AI); });
  return result;
}

describe('useBattle — scoring and match outcome', () => {
  it('starts a playable battle at nil-nil', () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    expect(result.current.status).toBe('playing');
    expect(result.current.playerScore).toBe(0);
    expect(result.current.aiScore).toBe(0);
    expect(result.current.target).toBe(10);
    expect(result.current.problem.op).toBe('add');
    expect(result.current.grid.filter(v => v !== null).length).toBeGreaterThan(1);
  });

  it('scores a correct tap and swaps in a different problem', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const first = result.current.problem;
    await tapCorrect(result);
    expect(result.current.playerScore).toBe(1);
    expect(result.current.aiScore).toBe(0);
    expect(result.current.problem).not.toEqual(first);
    expect(result.current.blanking).toBe(false);
  });

  it('declares the child the winner at exactly the target', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    for (let i = 0; i < 9; i++) await tapCorrect(result);
    expect(result.current.status).toBe('playing');
    expect(result.current.playerScore).toBe(9);
    await tapCorrect(result);
    expect(result.current.playerScore).toBe(10);
    expect(result.current.status).toBe('won');
  });

  it('loses the match if the child never answers', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    for (let i = 0; i < 10; i++) await letAiSolve(result);
    expect(result.current.aiScore).toBe(10);
    expect(result.current.status).toBe('lost');
  });

  it('stamps the match duration only once the battle is over', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    expect(result.current.matchDurationMs).toBeNull();
    for (let i = 0; i < 10; i++) await tapCorrect(result);
    expect(result.current.status).toBe('won');
    expect(result.current.matchDurationMs).toBeGreaterThan(0);
  });

  it('puts a fresh battle back on the board on retry', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    for (let i = 0; i < 10; i++) await letAiSolve(result);
    expect(result.current.status).toBe('lost');

    await act(async () => { result.current.reset(); });
    expect(result.current.status).toBe('playing');
    expect(result.current.playerScore).toBe(0);
    expect(result.current.aiScore).toBe(0);
    expect(result.current.matchDurationMs).toBeNull();
    expect(result.current.gridLocked).toBe(false);
    expect(result.current.blanking).toBe(false);
  });
});

// The gobble animation reads problemRef/gridRef inside the AI's setTimeout —
// values captured at render time, consumed seconds later.
describe('useBattle — the AI reads the CURRENT problem when its timer fires', () => {
  it('reveals the answer to the problem that was on screen', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    // Advance through two problems first, so a stale ref would hold an old one.
    await tapCorrect(result);
    await tapCorrect(result);
    const onScreen = result.current.problem;

    await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS); });
    expect(result.current.aiSolvedAnswer).toBe(onScreen.answer);
  });

  it('pounces on the grid cell actually holding that answer', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await tapCorrect(result);
    const grid = result.current.grid;
    const expectedCell = answerCellOf(grid);

    await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS); });
    expect(result.current.aiEatCellIndex).toBe(expectedCell);
    expect(grid[result.current.aiEatCellIndex]).toBe(result.current.aiSolvedAnswer);
  });

  it('clears the reveal when the next problem arrives', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await letAiSolve(result);
    expect(result.current.aiSolvedAnswer).toBeNull();
    expect(result.current.aiEatCellIndex).toBeNull();
  });
});

// configRef/layoutRef are what let the post-blank swap use the server's config
// rather than the hardcoded fallback the hook mounted with.
describe('useBattle — server config takes effect for later problems', () => {
  it('generates subsequent problems from the server ops, not the mount defaults', async () => {
    api.get.mockResolvedValue({
      configs: [{ node_id: NODE_ID, ops: ['mul'], range_min: 3, range_max: 4, ai_seconds: 10, shape_id: null }],
    });
    const { result } = renderHook(() => useBattle(NODE_ID));
    // Let the node-config promise resolve.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.problem.op).toBe('mul');

    // And the swap after a correct tap must still use it.
    await tapCorrect(result);
    expect(result.current.problem.op).toBe('mul');
  });

  it('keeps the fallback config when the server call fails', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.problem.op).toBe('add');
    await tapCorrect(result);
    expect(result.current.problem.op).toBe('add');
  });
});

describe('useBattle — wrong taps and the think-it-through lock', () => {
  it('flashes the tapped cell and locks the grid', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const cell = wrongCellOf(result.current.grid);
    await tapWrong(result);
    expect(result.current.wrongCellIndex).toBe(cell);
    expect(result.current.gridLocked).toBe(true);
    expect(result.current.playerScore).toBe(0);
    expect(result.current.aiScore).toBe(0);
  });

  it('ignores taps while locked, including the correct one', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await tapWrong(result);
    await act(async () => { result.current.handleCellTap(answerCellOf(result.current.grid)); });
    expect(result.current.playerScore).toBe(0);
  });

  it('releases the lock after the pause', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await tapWrong(result);
    await act(async () => { vi.advanceTimersByTime(LOCK_MS); });
    expect(result.current.gridLocked).toBe(false);
    await tapCorrect(result);
    expect(result.current.playerScore).toBe(1);
  });

  it('does not carry a lock over onto the next problem', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await tapWrong(result);
    expect(result.current.gridLocked).toBe(true);
    // The AI solves it while the lock is still counting down.
    await letAiSolve(result);
    expect(result.current.gridLocked).toBe(false);
    await tapCorrect(result);
    expect(result.current.playerScore).toBe(1);
  });
});

describe('useBattle — bond powers', () => {
  const bond = (kind, extra = {}) => ({
    bondPower: { kind, durationMs: 3000, cooldownMs: 20_000, highlightColor: '#abc', ...extra },
  });

  it('always includes the answer cell in Pip\'s 2x2 peek', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const expected = answerCellOf(result.current.grid);
    await act(async () => { result.current.triggerBondPower(bond('hint2x2')); });
    expect(result.current.hintCellIndices).toContain(expected);
    expect(result.current.hintColor).toBe('#abc');
  });

  it('pinpoints exactly the answer cell for a reveal', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const expected = answerCellOf(result.current.grid);
    await act(async () => { result.current.triggerBondPower(bond('revealAnswer')); });
    expect(result.current.revealCellIndex).toBe(expected);
  });

  it('never covers or zaps the answer cell', async () => {
    const { result: r1 } = renderHook(() => useBattle(NODE_ID));
    const answer1 = answerCellOf(r1.current.grid);
    await act(async () => { r1.current.triggerBondPower(bond('mushroomGrove')); });
    expect(r1.current.mushroomCellIndices).not.toContain(answer1);
    expect(r1.current.mushroomCellIndices.length).toBeGreaterThan(0);

    const { result: r2 } = renderHook(() => useBattle(NODE_ID));
    const answer2 = answerCellOf(r2.current.grid);
    await act(async () => { r2.current.triggerBondPower(bond('lightningStrike')); });
    expect(r2.current.zappedCellIndices).not.toContain(answer2);
    expect(r2.current.zappedCellIndices.length).toBeLessThanOrEqual(4);
  });

  it('makes covered cells inert rather than penalised', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('mushroomGrove')); });
    const covered = result.current.mushroomCellIndices[0];
    await act(async () => { result.current.handleCellTap(covered); });
    expect(result.current.gridLocked).toBe(false);
    expect(result.current.wrongCellIndex).toBeNull();
    expect(result.current.aiScore).toBe(0);
  });

  it('holds the AI off entirely while locked out', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('aiLockout', { durationMs: 15_000 })); });
    expect(result.current.aiLocked).toBe(true);
    // Well past the AI's normal window.
    await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS + 1000); });
    expect(result.current.aiScore).toBe(0);
  });

  it('gives the AI a fresh full delay after the lockout, not a resumed one', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('aiLockout', { durationMs: 3000 })); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(result.current.aiLocked).toBe(false);
    // Just under a full fresh delay: still nothing.
    await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS - 100); });
    expect(result.current.aiScore).toBe(0);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.aiScore).toBe(1);
  });

  it('forgives one wrong tap with the petal shield, then re-arms only next problem', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('petalShield')); });
    expect(result.current.shieldActive).toBe(true);

    await tapWrong(result);
    // Mistake still flashes, but no lock.
    expect(result.current.gridLocked).toBe(false);
    expect(result.current.shieldActive).toBe(false);

    // Second mistake on the same problem is not forgiven.
    await tapWrong(result);
    expect(result.current.gridLocked).toBe(true);
  });

  it('refuses a second power while one is active or on cooldown', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('revealAnswer')); });
    const firstCell = result.current.revealCellIndex;
    expect(result.current.bondCooldownMs).toBe(20_000);

    // Still active -> ignored.
    await act(async () => { result.current.triggerBondPower(bond('mushroomGrove')); });
    expect(result.current.mushroomCellIndices).toBeNull();

    // Effect expires, but the cooldown has not.
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(result.current.revealCellIndex).toBeNull();
    await act(async () => { result.current.triggerBondPower(bond('mushroomGrove')); });
    expect(result.current.mushroomCellIndices).toBeNull();
    expect(firstCell).not.toBeNull();
  });

  it('ticks the cooldown down to zero', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('petalShield', { cooldownMs: 1000 })); });
    expect(result.current.bondCooldownMs).toBe(1000);
    expect(result.current.bondCooldownTotalMs).toBe(1000);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(result.current.bondCooldownMs).toBe(0);
  });

  it('clears every active effect when the battle ends', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.triggerBondPower(bond('mushroomGrove')); });
    expect(result.current.mushroomCellIndices).not.toBeNull();
    for (let i = 0; i < 10; i++) await tapCorrect(result);
    expect(result.current.status).toBe('won');
    expect(result.current.mushroomCellIndices).toBeNull();
    expect(result.current.bondActive).toBe(false);
    expect(result.current.bondCooldownMs).toBe(0);
  });
});

// playerScoreRef/aiScoreRef exist purely so the unmount cleanup can report final
// scores after React has torn state down. Nothing in the UI would reveal a stale
// read here — only the analytics row would be wrong.
describe('useBattle — match reporting', () => {
  it('opens a match row on mount', () => {
    renderHook(() => useBattle(NODE_ID));
    expect(postsTo('/api/matches')).toHaveLength(1);
    expect(postsTo('/api/matches')[0][1]).toEqual({ node_id: NODE_ID });
  });

  it('reports the score the child actually reached when they walk away mid-battle', async () => {
    const { result, unmount } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { await Promise.resolve(); }); // let the match id land
    await tapCorrect(result);
    await tapCorrect(result);
    await tapCorrect(result);
    await letAiSolve(result);

    unmount();

    const [path, body] = api.post.mock.calls.at(-1);
    expect(path).toBe('/api/matches/match-1/end');
    expect(body).toEqual({ outcome: 'incomplete', player_score: 3, ai_score: 1 });
  });

  it('finalises a win as a child victory, and only once', async () => {
    const { result, unmount } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 10; i++) await tapCorrect(result);

    const ends = postsTo('/api/matches/match-1/end');
    expect(ends).toHaveLength(1);
    expect(ends[0][1]).toMatchObject({ outcome: 'child', player_score: 10 });

    // Unmounting after the match is closed must not open a second end row.
    unmount();
    expect(postsTo('/api/matches/match-1/end')).toHaveLength(1);
  });

  it('finalises a loss as an AI victory', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 10; i++) await letAiSolve(result);
    const ends = postsTo('/api/matches/match-1/end');
    expect(ends).toHaveLength(1);
    expect(ends[0][1]).toMatchObject({ outcome: 'ai', ai_score: 10 });
  });
});

describe('useBattle — attempt logging', () => {
  it('batches a correct answer with the problem and a solve time', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const p = result.current.problem;
    await act(async () => { vi.advanceTimersByTime(1500); });
    await act(async () => { result.current.handleCellTap(answerCellOf(result.current.grid)); });

    // Queued, not sent yet.
    expect(postsTo('/api/attempts')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(5000); });

    const [, body] = postsTo('/api/attempts')[0];
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]).toMatchObject({
      node_id: NODE_ID, operand_a: p.a, operand_b: p.b, operator: p.op,
      answer: p.answer, outcome: 'child',
    });
    expect(body.attempts[0].time_ms).toBeGreaterThanOrEqual(1500);
  });

  it('records a wrong tap with both the tapped value and the right answer', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const p = result.current.problem;
    const cell = wrongCellOf(result.current.grid);
    const tapped = result.current.grid[cell];
    await tapWrong(result);
    await act(async () => { vi.advanceTimersByTime(5000); });

    const [, body] = postsTo('/api/attempts')[0];
    expect(body.wrongTaps).toHaveLength(1);
    expect(body.wrongTaps[0]).toMatchObject({
      node_id: NODE_ID, correct_answer: p.answer, tapped_value: tapped, operator: p.op,
    });
  });

  it('credits the AI when its timer beats the child', async () => {
    const { result } = renderHook(() => useBattle(NODE_ID));
    const p = result.current.problem;
    await letAiSolve(result);
    await act(async () => { vi.advanceTimersByTime(5000); });

    const attempts = postsTo('/api/attempts').flatMap(([, b]) => b.attempts);
    const aiAttempt = attempts.find(a => a.outcome === 'ai');
    expect(aiAttempt).toMatchObject({ operand_a: p.a, operand_b: p.b, answer: p.answer });
  });

  it('flushes whatever is queued on unmount rather than dropping it', async () => {
    const { result, unmount } = renderHook(() => useBattle(NODE_ID));
    await act(async () => { result.current.handleCellTap(answerCellOf(result.current.grid)); });
    expect(postsTo('/api/attempts')).toHaveLength(0);
    unmount();
    const attempts = postsTo('/api/attempts').flatMap(([, b]) => b.attempts);
    expect(attempts).toHaveLength(1);
  });

  // Stay under AI_DELAY_MS: once the AI solves, it queues an attempt of its own,
  // so an idle window is only idle for less than one AI turn.
  it('sends nothing when there is nothing to send', async () => {
    renderHook(() => useBattle(NODE_ID));
    await act(async () => { vi.advanceTimersByTime(AI_DELAY_MS - 1000); });
    expect(postsTo('/api/attempts')).toHaveLength(0);
  });
});
