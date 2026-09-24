import { BATTLE_SHAPES } from './battleShapes.js';

// Battle config per node. Each node defines:
//   ops:        which operations are allowed
//   range:      [min, max] for operand range
//   aiSeconds:  approximate seconds per AI correct answer (lower = harder)
//
// These hardcoded defaults are used as a fallback when the `nodes` section of
// the server's /api/rule-settings response hasn't loaded yet (or fails). The authoritative
// values live in the Postgres `node_config` table (see
// server/db/schema.js) and are editable from /admin.
//
// World 1 (1-8):  addition foundation, 1-12
// World 2 (9-16): addition mastery — larger numbers, faster
// World 3 (17-25): subtraction, then mixed +/−
// World 4 (26-33): multiplication intro, 2-12 tables
// World 5 (34-41): mixed all-ops mastery

export const PROBLEMS_TO_WIN = 10;

export const DEFAULT_BATTLE_CONFIGS = {
  // --- World 1: Mushroom Forest (addition foundation, 1-12) ---
  1:  { ops: ['add'],          range: [1,  3], aiSeconds: 10.0 },
  2:  { ops: ['add'],          range: [1,  5], aiSeconds:  9.0 },
  3:  { ops: ['add'],          range: [1,  6], aiSeconds:  8.0 },
  4:  { ops: ['add'],          range: [1,  7], aiSeconds:  7.5 },
  5:  { ops: ['add'],          range: [1,  8], aiSeconds:  7.0 },
  6:  { ops: ['add'],          range: [1, 10], aiSeconds:  6.5 },
  7:  { ops: ['add'],          range: [1, 12], aiSeconds:  6.0 },
  8:  { ops: ['add'],          range: [1, 12], aiSeconds:  4.5 },

  // --- World 2: Honeyfield Plains (addition mastery, larger numbers) ---
  9:  { ops: ['add'],          range: [1, 14], aiSeconds:  7.0 },
  10: { ops: ['add'],          range: [1, 16], aiSeconds:  6.5 },
  11: { ops: ['add'],          range: [1, 18], aiSeconds:  6.0 },
  12: { ops: ['add'],          range: [1, 20], aiSeconds:  5.5 },
  13: { ops: ['add'],          range: [5, 20], aiSeconds:  5.0 },
  14: { ops: ['add'],          range: [5, 25], aiSeconds:  5.0 },
  15: { ops: ['add'],          range: [8, 25], aiSeconds:  4.5 },
  16: { ops: ['add'],          range: [8, 30], aiSeconds:  4.0 },

  // --- World 3: Crystal Caves (subtraction, then mixed +/−) ---
  17: { ops: ['sub'],          range: [1,  5], aiSeconds:  9.0 },
  18: { ops: ['sub'],          range: [1,  7], aiSeconds:  8.0 },
  19: { ops: ['sub'],          range: [1,  9], aiSeconds:  7.0 },
  20: { ops: ['sub'],          range: [1, 10], aiSeconds:  6.5 },
  21: { ops: ['sub'],          range: [1, 12], aiSeconds:  6.0 },
  22: { ops: ['add', 'sub'],   range: [1,  8], aiSeconds:  6.0 },
  23: { ops: ['add', 'sub'],   range: [1, 10], aiSeconds:  5.5 },
  24: { ops: ['add', 'sub'],   range: [1, 12], aiSeconds:  5.0 },
  25: { ops: ['add', 'sub'],   range: [1, 12], aiSeconds:  4.0 },

  // --- World 4: Sakura Vale (multiplication intro, 2-12) ---
  26: { ops: ['mul'],          range: [2,  3], aiSeconds:  9.0 },
  27: { ops: ['mul'],          range: [2,  4], aiSeconds:  8.0 },
  28: { ops: ['mul'],          range: [2,  5], aiSeconds:  7.0 },
  29: { ops: ['mul'],          range: [2,  7], aiSeconds:  6.5 },
  30: { ops: ['mul'],          range: [2,  9], aiSeconds:  6.0 },
  31: { ops: ['mul'],          range: [2, 10], aiSeconds:  5.5 },
  32: { ops: ['mul'],          range: [2, 12], aiSeconds:  5.0 },
  33: { ops: ['mul'],          range: [2, 12], aiSeconds:  4.0 },

  // --- World 5: Cloudspire Heights (mixed all-ops mastery) ---
  34: { ops: ['add', 'sub', 'mul'], range: [1, 10], aiSeconds: 6.0 },
  35: { ops: ['add', 'sub', 'mul'], range: [1, 12], aiSeconds: 5.5 },
  36: { ops: ['add', 'sub', 'mul'], range: [2, 12], aiSeconds: 5.0 },
  37: { ops: ['mul'],               range: [3, 12], aiSeconds: 4.5 },
  38: { ops: ['add', 'sub', 'mul'], range: [2, 12], aiSeconds: 4.5 },
  39: { ops: ['add', 'sub', 'mul'], range: [2, 12], aiSeconds: 4.0 },
  40: { ops: ['add', 'sub', 'mul'], range: [3, 12], aiSeconds: 3.5 },
  41: { ops: ['add', 'sub', 'mul'], range: [2, 15], aiSeconds: 3.0 },
};

export function getDefaultBattleConfig(nodeId) {
  return DEFAULT_BATTLE_CONFIGS[nodeId] || DEFAULT_BATTLE_CONFIGS[1];
}

// Build a runtime battle config from a server node_config row (a `nodes[]`
// entry of /api/rule-settings, or a /api/node-config `configs[]` one). Falls back
// to the hardcoded default for any missing field — keeps the game playable if
// the row is corrupt or partially populated.
export function battleConfigFromServer(serverRow, nodeId) {
  const fallback = getDefaultBattleConfig(nodeId);
  if (!serverRow) return fallback;
  const ops = Array.isArray(serverRow.ops) && serverRow.ops.length > 0 ? serverRow.ops : fallback.ops;
  const rMin = Number.isFinite(serverRow.range_min) ? serverRow.range_min : fallback.range[0];
  const rMax = Number.isFinite(serverRow.range_max) ? serverRow.range_max : fallback.range[1];
  const aiSeconds = Number.isFinite(serverRow.ai_seconds) ? serverRow.ai_seconds : fallback.aiSeconds;
  const shapeId = typeof serverRow.shape_id === 'string' ? serverRow.shape_id : null;
  return { ops, range: [rMin, rMax], aiSeconds, shapeId };
}

const OP_SYMBOL = { add: '+', sub: '−', mul: '×', div: '÷' };

// Problem and grid generation take an optional `rng` (`() => number` in
// [0, 1), e.g. createSeededRandom(seed).next from src/rules/seededRandom.js)
// that defaults to Math.random, so the web draws exactly as before while a
// seeded run is repeatable. The ORDER of draws is part of the rule: the Swift
// port and golden/battle-problems.json depend on it, so reordering any draw
// below is a rule change (regenerate the golden files).
function randInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Generate one problem appropriate for this node.
// Returns { a, b, op, text, answer }
export function generateProblem(config, rng = Math.random) {
  const op = pick(config.ops, rng);
  const [min, max] = config.range;

  let a, b, answer;
  if (op === 'add') {
    a = randInt(min, max, rng);
    b = randInt(min, max, rng);
    answer = a + b;
  } else if (op === 'sub') {
    a = randInt(min, max, rng);
    b = randInt(min, a, rng); // ensure non-negative
    answer = a - b;
  } else if (op === 'mul') {
    a = randInt(min, max, rng);
    b = randInt(min, max, rng);
    answer = a * b;
  } else if (op === 'div') {
    // Whole-number division: pick divisor and quotient, present dividend ÷ divisor.
    const divMin = Math.max(2, min);
    const divMax = Math.max(divMin, max);
    b = randInt(divMin, divMax, rng);
    answer = randInt(divMin, divMax, rng);
    a = b * answer;
  }

  return {
    a,
    b,
    op,
    text: `${a} ${OP_SYMBOL[op]} ${b}`,
    answer,
  };
}

export const DEFAULT_GRID_SIZE = 6;

// Build a gridSize × gridSize grid of numbers containing the correct answer
// exactly once and distractors in a plausible range around it.
export function buildGrid(answer, config, gridSize = DEFAULT_GRID_SIZE, rng = Math.random) {
  const total = gridSize * gridSize;
  const distractorMax = computeDistractorMax(config);
  const cells = [answer];

  while (cells.length < total) {
    const candidate = randInt(0, distractorMax, rng);
    if (candidate === answer) continue;
    cells.push(candidate);
  }

  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

function computeDistractorMax(config) {
  const [, max] = config.range;
  if (config.ops.includes('mul')) return max * max;
  return max * 2;
}

// Public helper for trial-style screens that label results per operation.
export const OP_LABEL = OP_SYMBOL;

// ─── Geometric battle-grid layouts ───────────────────────────────────────────
//
// X = active cell (shows a number), . = empty spacer (invisible gap).
// Per-node layouts now come from the shared shape library
// (src/data/battleShapes.js) via shape_id on node_config. The per-world map
// below is the legacy fallback for when a node row lacks shape_id (e.g.,
// during the initial fetch, or for the Dragon's Trial flow).

const LAYOUTS_ART = {
  // World 1 — Mushroom Forest: diamond
  1: `\
..X..
.XXX.
XXXXX
.XXX.
..X..`,

  // World 2 — Honeyfield Plains: wide Z
  2: `\
XXXXX
...XX
..X..
XX...
XXXXX`,

  // World 3 — Crystal Caves: hexagon
  3: `\
.XXX.
XXXXX
XXXXX
.XXX.`,

  // World 4 — Sakura Vale: starburst / flower corners
  4: `\
X.X.X
.XXX.
XXXXX
.XXX.
X.X.X`,

  // World 5 — Cloudspire Heights: staircase
  5: `\
XXX...
.XXX..
..XXX.
...XXX`,
};

// Parse a layout art string into { cols, rows, cells: boolean[] }.
// cells[i] is true when position i is an active (numbered) cell.
export function parseBattleLayout(art) {
  const lines = art.split('\n').filter(l => l.length > 0);
  const cols = Math.max(...lines.map(l => l.length));
  const cells = [];
  for (const line of lines) {
    for (let c = 0; c < cols; c++) {
      cells.push(c < line.length ? line[c] === 'X' : false);
    }
  }
  return { cols, rows: lines.length, cells };
}

export function getBattleLayout(worldId) {
  return parseBattleLayout(LAYOUTS_ART[worldId] ?? LAYOUTS_ART[1]);
}

// Resolve a layout from a shape id in BATTLE_SHAPES. Falls back to the
// per-world layout (or world 1) when the shape id is missing/unknown — keeps
// the grid renderable while the server config is still loading.
export function getLayoutForShape(shapeId, fallbackWorldId = 1) {
  const shape = shapeId ? BATTLE_SHAPES[shapeId] : null;
  if (!shape) return getBattleLayout(fallbackWorldId);
  return parseBattleLayout(shape.art);
}

// Build a grid from a layout: active cells get numbers, spacers get null.
// Returns an array parallel to layout.cells. Draws: one per distractor
// candidate (a candidate equal to the answer is redrawn), then a Fisher–Yates
// shuffle from the last index down.
export function buildGridFromLayout(answer, config, layout, rng = Math.random) {
  const activeCount = layout.cells.filter(Boolean).length;
  const distractorMax = computeDistractorMax(config);
  const values = [answer];
  while (values.length < activeCount) {
    const candidate = randInt(0, distractorMax, rng);
    if (candidate !== answer) values.push(candidate);
  }
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  let vi = 0;
  return layout.cells.map(active => (active ? values[vi++] : null));
}
