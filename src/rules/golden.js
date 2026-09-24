// The golden-file fixtures: what the JavaScript rules produce from fixed inputs
// and seeds, written to golden/ at the repo root for the Swift GameRules tests
// to reproduce exactly (ADR 0005).
//
// This module only BUILDS the fixtures; scripts/generate-golden.mjs writes them
// (`npm run golden:generate`) and golden.test.js fails when a checked-in file no
// longer matches what is built here. So changing a rule is: change it, run the
// script, commit the regenerated JSON — and the iOS tests then fail until Swift
// catches up, which is the point.
//
// Format rules every fixture follows, because a Swift decoder reads them:
//   - One JSON file per rule area, keyed by filename in buildGoldenFiles().
//   - Each file carries `fixture` (its name) and `version` (bump it when the
//     SHAPE changes, not when the values do) at the top.
//   - 64-bit integers are decimal strings: a JSON number cannot carry them
//     through JavaScript intact, and Swift's UInt64("…") parses them exactly.
//   - Floats are plain JSON numbers. JS prints the shortest string that
//     round-trips, so Swift's decoder recovers the identical Double.
//   - Output is stable: fixed key order, two-space indent, trailing newline.
//
// Pure data, no Node APIs, so the web test project can import it.

import { createSeededRandom } from './seededRandom.js';
import {
  DEFAULT_BATTLE_CONFIGS,
  buildGridFromLayout,
  generateProblem,
  getBattleLayout,
  getLayoutForShape,
  parseBattleLayout,
} from '../data/battleData.js';
import { BATTLE_SHAPES } from '../data/battleShapes.js';

// Seeds chosen to cover the edges of the 64-bit arithmetic: zero, small, a
// typical value, the largest exact JS integer, and all-ones (which wraps on the
// very first add).
const PRNG_SEEDS = ['0', '1', '42', '9007199254740991', '18446744073709551615'];
const PRNG_LENGTH = 16;

function prngFixture() {
  return {
    fixture: 'prng',
    version: 1,
    algorithm: 'splitmix64',
    description:
      'Per seed, the first outputs of createSeededRandom (src/rules/seededRandom.js) from a fresh generator. ' +
      '`uint64` is nextUint64() as decimal strings; `float` is next() from a SEPARATE fresh generator ' +
      'with the same seed, so each list starts at the first draw.',
    cases: PRNG_SEEDS.map(seed => {
      const ints = createSeededRandom(BigInt(seed));
      const floats = createSeededRandom(BigInt(seed));
      return {
        seed,
        uint64: Array.from({ length: PRNG_LENGTH }, () => ints.nextUint64().toString()),
        float: Array.from({ length: PRNG_LENGTH }, () => floats.next()),
      };
    }),
  };
}

// ─── battle-problems ─────────────────────────────────────────────────────────

const BATTLE_SEEDS = ['1', '42', '18446744073709551615'];
const GRID_SEEDS = ['7', '2024'];
const PROBLEMS_PER_CASE = 6;
// The legacy per-world layouts in battleData.js (LAYOUTS_ART keys).
const LEGACY_WORLD_IDS = [1, 2, 3, 4, 5];

// Configs no map node uses but the rules still handle: the Dragon's Trial's
// one-op configs (src/hooks/useDragonTrial.js configForOp, range [2, 10]) —
// the only place division is played today — plus range edges: division's
// divisor floor of 2, a one-value range, and all four ops mixed.
const EXTRA_BATTLE_CONFIGS = [
  { name: 'trial-add', ops: ['add'], range: [2, 10] },
  { name: 'trial-sub', ops: ['sub'], range: [2, 10] },
  { name: 'trial-mul', ops: ['mul'], range: [2, 10] },
  { name: 'trial-div', ops: ['div'], range: [2, 10] },
  { name: 'div-min-below-2', ops: ['div'], range: [1, 12] },
  { name: 'div-single', ops: ['div'], range: [1, 1] },
  { name: 'sub-single', ops: ['sub'], range: [4, 4] },
  { name: 'all-ops', ops: ['add', 'sub', 'mul', 'div'], range: [1, 15] },
];

function battleConfigs() {
  const nodes = Object.keys(DEFAULT_BATTLE_CONFIGS)
    .map(Number)
    .sort((a, b) => a - b)
    .map(nodeId => {
      const { ops, range } = DEFAULT_BATTLE_CONFIGS[nodeId];
      return { name: `node-${nodeId}`, ops, range };
    });
  return [...nodes, ...EXTRA_BATTLE_CONFIGS];
}

function layoutEntry(id, source, art) {
  const { cols, rows, cells } = parseBattleLayout(art);
  return { id, source, art, cols, rows, cells };
}

function battleProblemsFixture() {
  const configs = battleConfigs();
  const layouts = [
    ...Object.entries(BATTLE_SHAPES).map(([id, shape]) => layoutEntry(id, 'shape', shape.art)),
    ...LEGACY_WORLD_IDS.map(worldId => {
      const { cols, rows, cells } = getBattleLayout(worldId);
      return { id: `world-${worldId}`, source: 'world', cols, rows, cells };
    }),
  ];

  // Grid cases rotate through the configs so every layout meets several ops
  // and both distractor ceilings (max² with mul, 2·max without).
  let rotation = 0;
  const grids = [];
  for (const layout of layouts) {
    for (const seed of GRID_SEEDS) {
      const { name, ops, range } = configs[rotation++ % configs.length];
      const config = { ops, range };
      const rng = createSeededRandom(BigInt(seed)).next;
      const problem = generateProblem(config, rng);
      const grid = buildGridFromLayout(problem.answer, config, layout, rng);
      grids.push({ layout: layout.id, config: name, seed, problem, grid });
    }
  }

  return {
    fixture: 'battle-problems',
    version: 1,
    description:
      'Battle problem and grid generation (src/data/battleData.js) driven by createSeededRandom(seed).next. ' +
      '`problems`: per config and seed, PROBLEMS_PER_CASE successive generateProblem(config, rng) calls on ONE fresh generator. ' +
      '`layouts`: every battle shape (parseBattleLayout of its art) and legacy world layout; `cells` is row-major, true = numbered. ' +
      '`resolve`: getLayoutForShape(shapeId, fallbackWorldId) → layout id. ' +
      '`grids`: on one fresh generator per case, generateProblem(config, rng) then ' +
      'buildGridFromLayout(problem.answer, config, layout, rng) from the SAME generator, as a battle round does; ' +
      '`grid` is parallel to the layout cells, null for spacers.',
    configs,
    problems: configs.flatMap(({ name, ops, range }) =>
      BATTLE_SEEDS.map(seed => {
        const rng = createSeededRandom(BigInt(seed)).next;
        return {
          config: name,
          seed,
          problems: Array.from({ length: PROBLEMS_PER_CASE }, () => generateProblem({ ops, range }, rng)),
        };
      }),
    ),
    layouts,
    resolve: [
      { shapeId: 'heart', fallbackWorldId: 3 },
      { shapeId: null, fallbackWorldId: 4 },
      { shapeId: 'no-such-shape', fallbackWorldId: 2 },
      { shapeId: 'no-such-shape', fallbackWorldId: 9 },
    ].map(({ shapeId, fallbackWorldId }) => {
      const resolved = getLayoutForShape(shapeId, fallbackWorldId);
      const match = layouts.find(
        l => l.cols === resolved.cols && l.rows === resolved.rows &&
          l.cells.every((c, i) => c === resolved.cells[i]) &&
          (shapeId && BATTLE_SHAPES[shapeId] ? l.source === 'shape' : l.source === 'world'),
      );
      return { shapeId, fallbackWorldId, layout: match.id };
    }),
    grids,
  };
}

// filename (relative to golden/) → fixture object. Later rule tickets add
// their fixtures here.
export function buildGoldenFiles() {
  return {
    'prng.json': prngFixture(),
    'battle-problems.json': battleProblemsFixture(),
  };
}

// The exact bytes written to disk, so the script and the drift test agree.
export function serializeGolden(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
