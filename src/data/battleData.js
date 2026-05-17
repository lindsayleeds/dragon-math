// Battle config per node. Each node defines:
//   ops:        which operations are allowed
//   range:      [min, max] for operand range
//   aiSeconds:  approximate seconds per AI correct answer (lower = harder)
//
// These hardcoded defaults are used as a fallback when the server's
// /api/node-config response hasn't loaded yet (or fails). The authoritative
// values live in the SQLite `node_config` table and are editable from /admin.
//
// World 1 (1-8):  addition foundation, 1-12
// World 2 (9-16): addition mastery — larger numbers, faster
// World 3 (17-25): subtraction, then mixed +/−
// World 4 (26-33): multiplication intro, 2-12 tables
// World 5 (34-41): mixed all-ops mastery

export const PROBLEMS_TO_WIN = 10;

const DEFAULT_BATTLE_CONFIGS = {
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

// Build a runtime battle config from a server /api/node-config row. Falls back
// to the hardcoded default for any missing field — keeps the game playable if
// the row is corrupt or partially populated.
export function battleConfigFromServer(serverRow, nodeId) {
  const fallback = getDefaultBattleConfig(nodeId);
  if (!serverRow) return fallback;
  const ops = Array.isArray(serverRow.ops) && serverRow.ops.length > 0 ? serverRow.ops : fallback.ops;
  const rMin = Number.isFinite(serverRow.range_min) ? serverRow.range_min : fallback.range[0];
  const rMax = Number.isFinite(serverRow.range_max) ? serverRow.range_max : fallback.range[1];
  const aiSeconds = Number.isFinite(serverRow.ai_seconds) ? serverRow.ai_seconds : fallback.aiSeconds;
  return { ops, range: [rMin, rMax], aiSeconds };
}

const OP_SYMBOL = { add: '+', sub: '−', mul: '×' };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate one problem appropriate for this node.
// Returns { text, answer }
export function generateProblem(config) {
  const op = pick(config.ops);
  const [min, max] = config.range;

  let a, b, answer;
  if (op === 'add') {
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a + b;
  } else if (op === 'sub') {
    a = randInt(min, max);
    b = randInt(min, a); // ensure non-negative
    answer = a - b;
  } else if (op === 'mul') {
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a * b;
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
export function buildGrid(answer, config, gridSize = DEFAULT_GRID_SIZE) {
  const total = gridSize * gridSize;
  const distractorMax = computeDistractorMax(config);
  const cells = [answer];

  while (cells.length < total) {
    const candidate = randInt(0, distractorMax);
    if (candidate === answer) continue; // keep exactly one correct cell
    cells.push(candidate);
  }

  // Fisher-Yates shuffle
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

function computeDistractorMax(config) {
  const [, max] = config.range;
  if (config.ops.includes('mul')) return max * max;
  return max * 2;
}
