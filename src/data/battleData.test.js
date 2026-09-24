// Problem and grid generation take an injected rng (ADR 0005). These pin the
// two properties that matter: a seed makes a run repeatable, and leaving the
// rng out draws from Math.random in exactly the same order as before.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '../rules/seededRandom';
import { buildGrid, buildGridFromLayout, generateProblem, getLayoutForShape } from './battleData';

const MIXED = { ops: ['add', 'sub', 'mul', 'div'], range: [1, 12] };

function round(rng) {
  const layout = getLayoutForShape('heart');
  const problem = generateProblem(MIXED, rng);
  return { problem, grid: buildGridFromLayout(problem.answer, MIXED, layout, rng) };
}

afterEach(() => vi.restoreAllMocks());

describe('battle generation with an injected rng', () => {
  it('repeats exactly from the same seed', () => {
    const a = createSeededRandom(42n).next;
    const b = createSeededRandom(42n).next;
    for (let i = 0; i < 20; i++) expect(round(a)).toEqual(round(b));
  });

  it('defaults to Math.random with the same draws as an injected rng', () => {
    const seeded = createSeededRandom(7n).next;
    vi.spyOn(Math, 'random').mockImplementation(createSeededRandom(7n).next);
    for (let i = 0; i < 20; i++) {
      const layout = getLayoutForShape('cloud');
      const viaDefault = generateProblem(MIXED);
      const viaDefaultGrid = buildGridFromLayout(viaDefault.answer, MIXED, layout);
      const injected = generateProblem(MIXED, seeded);
      expect(viaDefault).toEqual(injected);
      expect(viaDefaultGrid).toEqual(buildGridFromLayout(injected.answer, MIXED, layout, seeded));
    }
    expect(buildGrid(5, MIXED)).toEqual(buildGrid(5, MIXED, undefined, seeded));
  });

  it('keeps the answer exactly once and spacers empty', () => {
    const rng = createSeededRandom(1n).next;
    const layout = getLayoutForShape('ring');
    for (let i = 0; i < 20; i++) {
      const { answer } = generateProblem(MIXED, rng);
      const grid = buildGridFromLayout(answer, MIXED, layout, rng);
      expect(grid.filter(v => v === answer)).toHaveLength(1);
      grid.forEach((v, idx) => expect(v === null).toBe(!layout.cells[idx]));
    }
  });
});
