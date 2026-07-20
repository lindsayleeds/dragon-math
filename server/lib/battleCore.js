// Server-authoritative battle problem generation for live PvP.
//
// In PvP the server is the SOLE source of problems and answer grids — both
// clients render exactly what the server sends — so this need not byte-match the
// client's single-player generator in src/data/battleData.js. The logic mirrors
// it (same distractor strategy, duplicates allowed) so problems feel the same.

const OP_SYMBOL = { add: '+', sub: '−', mul: '×', div: '÷' };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate one problem from a config { ops: [...], range: [min, max] }.
function generateProblem(config) {
  const op = pick(config.ops);
  const [min, max] = config.range;

  let a, b, answer;
  if (op === 'sub') {
    a = randInt(min, max);
    b = randInt(min, a); // non-negative result
    answer = a - b;
  } else if (op === 'mul') {
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a * b;
  } else if (op === 'div') {
    const divMin = Math.max(2, min);
    const divMax = Math.max(divMin, max);
    b = randInt(divMin, divMax);
    answer = randInt(divMin, divMax);
    a = b * answer;
  } else { // 'add' (and any unknown op) falls back to addition
    a = randInt(min, max);
    b = randInt(min, max);
    answer = a + b;
  }

  return { a, b, op, text: `${a} ${OP_SYMBOL[op]} ${b}`, answer };
}

function computeDistractorMax(config) {
  const [, max] = config.range;
  if (config.ops.includes('mul')) return max * max;
  return max * 2;
}

// Build a flat grid of `count` numbers containing the answer exactly once and
// plausible distractors (duplicates allowed, matching single-player behaviour).
function buildGrid(answer, config, count) {
  const distractorMax = Math.max(1, computeDistractorMax(config));
  const cells = [answer];
  while (cells.length < count) {
    const candidate = randInt(0, distractorMax);
    if (candidate !== answer) cells.push(candidate);
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

// PvP uses a simple full rectangular grid (no spacers). Both players see the
// same numbers in the same cells for a given problem.
const PVP_COLS = 5;
const PVP_ROWS = 5;

function makeProblem(config) {
  const problem = generateProblem(config);
  const grid = buildGrid(problem.answer, config, PVP_COLS * PVP_ROWS);
  return { problem, grid };
}

module.exports = { generateProblem, buildGrid, makeProblem, PVP_COLS, PVP_ROWS };
