// The Dragon Munchers rules as a pure, clock-driven reducer: the board, the
// level sequence, monster spawning and movement, collisions, lives, scoring,
// level progression and game over.
//
// src/components/DragonMunchers.jsx is rendering + input around this: it turns
// keys, swipes, taps and its own single setTimeout into events, and performs
// the side effects this returns (sounds, the high score, the leaderboard). A
// Swift port copies this file, and golden/munchers.json (built in
// src/rules/munchersTranscripts.js) is the check that the port matches it.
//
//   createMunchersState({ operation, baseNumber, progression, highScore, settings }, rng) → state
//   stepMunchers(state, event, rng)   → { state, effects }
//   nextTimerAt(state)                → ms | null
//   isFrozen(state), currentBase(state), isCorrectValue(state, value),
//   totalCorrect(state), maxEnemies(state), enemyInterval(state)   derived values
//
// Nothing here reads a clock or Math.random: time arrives as `event.now` (ms,
// any epoch — only differences matter) and randomness from the `rng` argument
// (`() => number` in [0, 1), e.g. createSeededRandom(seed).next). stepMunchers
// never mutates its input and returns the SAME state object when an event
// changes nothing, so a caller can skip a re-render.
//
// ─── Settings ───────────────────────────────────────────────────────────────
//
// Every tunable number — lives, points, monster timings and speed-up, chase
// odds, the progression bases — is a setting, served in the `munchers` section
// of GET /api/rule-settings. createMunchersState takes them as `settings`
// (default: the web fallbacks, DEFAULT_MUNCHERS_SETTINGS in
// src/data/ruleSettings.js) and keeps them on the state, so a game plays start
// to finish by the settings it was dealt with. What stays code is the board
// itself (GRID_COLS × GRID_ROWS, the ×MAX_FACTOR table): the layout is built
// around it.
//
// ─── State (plain data only — no functions, Maps, Sets or class instances) ──
//
//   settings        the tunables above (camelCase, as in src/data/ruleSettings.js)
//   operation       'mul' | 'add' | 'sub' | 'div'
//   baseNumber      the base the game was opened with
//   progression     true = the multi-level campaign
//   levels          number[]  base number of each level: [baseNumber], or the
//                   shuffled settings.progressionEasy then progressionHard
//   level           index into levels
//   board           (number | null)[]  GRID_COLS × GRID_ROWS, row-major; a
//                   value is correct iff isCorrectValue(state, value) — the
//                   board is always dealt for the current operation and base
//   eaten           cell indices already eaten this level, in eating order
//   muncher         the player's cell
//   enemies         { id, position, facing, nextPosition }[]
//                   facing: 'center' | 'up' | 'down' | 'left' | 'right'
//                   nextPosition: the planned cell during the telegraph, or
//                   null for a monster that has never been planned
//   nextEnemyId     id for the next monster (never reset, even across levels)
//   lives, score
//   highScore       best score on this device (given at create)
//   isNewHighScore  set when the game ends above highScore
//   correctEaten    correct answers eaten this level
//   babyDragons     { id: '<level>-<n>', emoji }[]  one per correct answer
//   wrongAnswer     { operation, baseNumber, value } | null — the wrong-answer
//                   message on screen, as it was when eaten
//   started         false on the dragon-picker screen
//   levelTransition true while the "level cleared" splash shows
//   caughtAt        cell where a monster caught the muncher, during the
//                   gobble beat, else null
//   gameOver
//   timers          { id, kind, at }[]  pending deadlines (see below)
//   nextTimerId     id for the next timer
//
// ─── Frozen ─────────────────────────────────────────────────────────────────
//
// Play is frozen before `start`, after game over, during the level splash and
// during the gobble beat. While frozen the monsters neither spawn nor move and
// `eat`/`tapCell` are refused. `move` is still accepted (unless the board is
// not in play: not started, or game over), because the on-screen arrow buttons
// always moved the muncher — the web's keyboard and swipe handlers simply don't
// send moves while frozen. A frozen move never counts as walking into a monster.
//
// The wrong-answer message does NOT freeze play: the monsters keep coming while
// it shows. Dismissing it costs a life.
//
// ─── Timers ─────────────────────────────────────────────────────────────────
//
// Fired in (at, id) order. A timer fires AT its `at`, not at the event's
// `now`, so a late tick replays exactly what on-time ticks would have (a
// repeating timer catches up one step at a time, keeping its id). Kinds:
//
//   spawn         every settings.spawnIntervalMs: add a monster if there is room
//   enemyPlan     every enemyInterval(state): each monster turns toward its
//                 next cell (the telegraph) and schedules an enemyCommit
//   enemyCommit   settings.enemyTelegraphMs after a plan: the monsters step
//   caughtEnd     settings.caughtBeatMs after a catch: lose a life, back to the start
//
// Whenever play unfreezes, spawn and then enemyPlan are armed afresh from that
// moment (spawn first, so it wins a tie); a change of maxEnemies restarts spawn
// and a change of enemyInterval restarts enemyPlan (dropping a pending commit),
// as the web's intervals did. Freezing cancels spawn, enemyPlan and
// enemyCommit. caughtEnd is never cancelled, not even by game over.
//
// After every fired timer and after the event itself: if play is not frozen
// and a monster stands on the muncher, the muncher is caught (sound, caughtAt,
// a caughtEnd timer) — then the clocks are re-synced as above. So a catch
// cancels any later timer due at the same moment.
//
// ─── Events (each carries `now`) ────────────────────────────────────────────
//
//   { type: 'start', now }                    the child leaves the dragon picker
//   { type: 'tick', now }                     fire every timer due by `now`
//   { type: 'move', now, direction }          'up' | 'down' | 'left' | 'right'
//   { type: 'eat', now }                      eat the number under the muncher
//   { type: 'tapCell', now, cell }            eat if it is the muncher's cell,
//                                             step if orthogonally adjacent
//   { type: 'dismissWrongAnswer', now }       close the message: -1 life
//   { type: 'advanceLevel', now }             leave the level splash
//   { type: 'configChanged', now, operation, baseNumber, progression }
//                                             new props: re-plan levels and
//                                             re-deal the board as needed
//
// Every event first fires the timers due by its `now`, then applies itself.
//
// ─── Effects (what the caller must do; plain data) ──────────────────────────
//
//   { type: 'sound', sound: 'correct' | 'wrong' | 'caught' }
//   { type: 'saveHighScore', score }   the game ended on a new best
//   { type: 'gameOver', score }        the game just ended (leaderboard)
//
// ─── Random draws, in order (part of the rule — the Swift port depends on it) ─
//
//   create:          levels (progression only), then the board
//   levels:          shuffle(progressionEasy), then shuffle(progressionHard)
//   board:           shuffle of the cell indices 0..TOTAL_CELLS-1, then one
//                    draw per distractor cell, j = floor(rng() * pool.length)
//   configChanged:   levels if progression or baseNumber changed, then the
//                    board if operation or currentBase changed
//   advanceLevel:    the board, if currentBase changed
//   eat (correct):   one draw for the baby dragon's emoji
//   spawn:           one draw, only when there is room and a safe cell
//   enemyPlan:       per monster in array order: one draw (chase if < chaseChance),
//                    plus one to pick a direction when it wanders
//   shuffle:         Fisher–Yates from the last index down,
//                    j = floor(rng() * (i + 1))

import { DEFAULT_MUNCHERS_SETTINGS } from '../data/ruleSettings.js';

// ─── The board (code, not settings) ─────────────────────────────────────────

export const GRID_COLS = 5;
export const GRID_ROWS = 6;
export const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
// The muncher starts (and restarts after a catch) in the bottom-right corner.
export const START_CELL = TOTAL_CELLS - 1;
// Times tables run up to ×12, so each game covers the full 1..12 table.
export const MAX_FACTOR = 12;

export const BABY_DRAGON_EMOJIS = ['🐉', '🦕', '🦖', '🐲'];

export const TIMER = Object.freeze({
  SPAWN: 'spawn',
  ENEMY_PLAN: 'enemyPlan',
  ENEMY_COMMIT: 'enemyCommit',
  CAUGHT_END: 'caughtEnd',
});

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function shuffle(values, rng) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function getCorrectAnswers(operation, baseNumber) {
  const raw = [];
  for (let i = 1; i <= MAX_FACTOR; i++) {
    if (operation === 'mul') raw.push(baseNumber * i);
    else if (operation === 'add') raw.push(baseNumber + i);
    else if (operation === 'sub') raw.push(baseNumber - i);
    else if (operation === 'div') raw.push(Math.floor(baseNumber / i));
  }
  // Keep only positive whole answers, with no duplicates.
  return [...new Set(raw.filter(v => v >= 1))];
}

// Largest number allowed to appear on the grid, so distractors stay in range
// with the answers (e.g. multiples of 3 → nothing bigger than 12 × 3 = 36).
export function getMaxValue(operation, baseNumber) {
  switch (operation) {
    case 'mul':
      return baseNumber * MAX_FACTOR;
    case 'add':
      return baseNumber + MAX_FACTOR;
    case 'sub':
    case 'div':
      return baseNumber;
    default:
      return 100;
  }
}

// Points per correct answer: the easy bases (up to easyMaxBase) are worth
// easyPoints, the harder ones hardPoints.
export function pointsForBase(baseNumber, settings = DEFAULT_MUNCHERS_SETTINGS) {
  return baseNumber <= settings.easyMaxBase ? settings.easyPoints : settings.hardPoints;
}

// Progression campaign: warm up on the easy bases in a random order, then step
// up to the hard ones. Each base number is one "level".
export function buildLevels(progression, baseNumber, rng, settings = DEFAULT_MUNCHERS_SETTINGS) {
  if (!progression) return [baseNumber];
  const easy = shuffle(settings.progressionEasy, rng);
  const hard = shuffle(settings.progressionHard, rng);
  return [...easy, ...hard];
}

// Every correct answer on a random cell, then the remaining cells filled with
// in-range numbers that are NOT valid answers, so a real multiple can never be
// shown as "wrong". A cell stays null when there is nothing valid to show.
export function generateBoard(operation, baseNumber, rng) {
  const correctAnswers = getCorrectAnswers(operation, baseNumber);
  const maxValue = getMaxValue(operation, baseNumber);
  const board = Array(TOTAL_CELLS).fill(null);
  const positions = shuffle(Array.from({ length: TOTAL_CELLS }, (_, i) => i), rng);

  const correctSet = new Set(correctAnswers);
  const numCorrect = Math.min(correctAnswers.length, TOTAL_CELLS);
  for (let i = 0; i < numCorrect; i++) {
    board[positions[i]] = correctAnswers[i];
  }

  const distractorPool = [];
  for (let v = 1; v <= maxValue; v++) {
    if (!correctSet.has(v)) distractorPool.push(v);
  }
  for (let i = numCorrect; i < TOTAL_CELLS; i++) {
    if (distractorPool.length === 0) break;
    const value = distractorPool[Math.floor(rng() * distractorPool.length)];
    board[positions[i]] = value;
  }
  return board;
}

const rowOf = cell => Math.floor(cell / GRID_COLS);
const colOf = cell => cell % GRID_COLS;

// The cell one step from `cell`, or `cell` itself at the edge.
export function stepFrom(cell, direction) {
  let row = rowOf(cell);
  let col = colOf(cell);
  if (direction === 'up' && row > 0) row--;
  else if (direction === 'down' && row < GRID_ROWS - 1) row++;
  else if (direction === 'left' && col > 0) col--;
  else if (direction === 'right' && col < GRID_COLS - 1) col++;
  return row * GRID_COLS + col;
}

// A random free cell that isn't the player's or any of the eight touching it
// (Chebyshev distance > 1), or null when there is none.
export function pickSpawnPosition(muncher, occupied, rng) {
  const munRow = rowOf(muncher);
  const munCol = colOf(muncher);
  const candidates = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (occupied.includes(i)) continue;
    if (Math.max(Math.abs(rowOf(i) - munRow), Math.abs(colOf(i) - munCol)) > 1) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// Where a monster steps next (chase the muncher settings.chaseChance of the
// time — diagonally if need be — otherwise wander one orthogonal step) and
// which way it looks while doing it (horizontal lean wins on a diagonal).
export function planEnemyMove(position, muncher, rng, settings = DEFAULT_MUNCHERS_SETTINGS) {
  const row = rowOf(position);
  const col = colOf(position);
  let newRow = row;
  let newCol = col;

  if (rng() < settings.chaseChance) {
    const munRow = rowOf(muncher);
    const munCol = colOf(muncher);
    if (row < munRow) newRow++;
    else if (row > munRow) newRow--;
    if (col < munCol) newCol++;
    else if (col > munCol) newCol--;
  } else {
    const dirs = [];
    if (row > 0) dirs.push('up');
    if (row < GRID_ROWS - 1) dirs.push('down');
    if (col > 0) dirs.push('left');
    if (col < GRID_COLS - 1) dirs.push('right');
    if (dirs.length > 0) {
      const dir = dirs[Math.floor(rng() * dirs.length)];
      if (dir === 'up') newRow--;
      else if (dir === 'down') newRow++;
      else if (dir === 'left') newCol--;
      else if (dir === 'right') newCol++;
    }
  }

  let facing = 'center';
  if (newCol < col) facing = 'left';
  else if (newCol > col) facing = 'right';
  else if (newRow < row) facing = 'up';
  else if (newRow > row) facing = 'down';
  return { newPosition: newRow * GRID_COLS + newCol, facing };
}

// ─── Derived values ─────────────────────────────────────────────────────────

export function currentBase(state) {
  return state.levels[state.level] ?? state.baseNumber;
}

export function isCorrectValue(state, value) {
  return value !== null && getCorrectAnswers(state.operation, currentBase(state)).includes(value);
}

export function totalCorrect(state) {
  const correct = getCorrectAnswers(state.operation, currentBase(state));
  return state.board.filter(value => value !== null && correct.includes(value)).length;
}

// Difficulty scales with progress: a new monster joins every
// levelsPerExtraEnemy cleared levels (at most maxEnemies)...
export function maxEnemies(state) {
  const { maxEnemies: cap, levelsPerExtraEnemy } = state.settings;
  return state.progression
    ? Math.min(cap, 1 + Math.floor(state.level / levelsPerExtraEnemy))
    : 1;
}

// ...and the monsters speed up by enemySpeedupPerLevelMs every level (never
// faster than minEnemyIntervalMs).
export function enemyInterval(state) {
  const { enemyMoveIntervalMs, enemySpeedupPerLevelMs, minEnemyIntervalMs } = state.settings;
  return state.progression
    ? Math.max(minEnemyIntervalMs, enemyMoveIntervalMs - state.level * enemySpeedupPerLevelMs)
    : enemyMoveIntervalMs;
}

export function isFrozen(state) {
  return !state.started || state.gameOver || state.levelTransition || state.caughtAt !== null;
}

// The earliest pending deadline, for the caller to schedule a `tick` at.
export function nextTimerAt(state) {
  const next = earliestTimer(state.timers);
  return next ? next.at : null;
}

// ─── The reducer ────────────────────────────────────────────────────────────

// A dealt game on the dragon-picker screen: the board is on the table but no
// clock runs until `start`.
export function createMunchersState(
  { operation, baseNumber, progression = false, highScore = 0, settings = DEFAULT_MUNCHERS_SETTINGS },
  rng = Math.random,
) {
  const levels = buildLevels(progression, baseNumber, rng, settings);
  const s = {
    settings,
    operation,
    baseNumber,
    progression,
    levels,
    level: 0,
    board: null,
    eaten: [],
    muncher: START_CELL,
    enemies: [],
    nextEnemyId: 0,
    lives: settings.startingLives,
    score: 0,
    highScore,
    isNewHighScore: false,
    correctEaten: 0,
    babyDragons: [],
    wrongAnswer: null,
    started: false,
    levelTransition: false,
    caughtAt: null,
    gameOver: false,
    timers: [],
    nextTimerId: 1,
  };
  s.board = generateBoard(operation, currentBase(s), rng);
  return s;
}

export function stepMunchers(state, event, rng = Math.random) {
  // Work on a shallow copy. Nested values (board, enemies, eaten, timers, …)
  // are never mutated, only replaced.
  const s = { ...state };
  const effects = [];
  let changed = advance(s, event.now, rng, effects);
  const afterTimers = { ...s };

  switch (event.type) {
    case 'tick':
      break;
    case 'start':
      if (s.started) break;
      s.started = true;
      changed = true;
      break;
    case 'move':
      changed = move(s, event.direction) || changed;
      break;
    case 'eat':
      changed = eat(s, rng, effects) || changed;
      break;
    case 'tapCell':
      changed = tapCell(s, event.cell, rng, effects) || changed;
      break;
    case 'dismissWrongAnswer':
      if (s.wrongAnswer === null || s.gameOver) break;
      s.wrongAnswer = null;
      loseLife(s);
      changed = true;
      break;
    case 'advanceLevel':
      if (!s.levelTransition) break;
      advanceLevel(s, rng);
      changed = true;
      break;
    case 'configChanged':
      changed = configChanged(s, event, rng) || changed;
      break;
    default:
      throw new Error(`unknown munchers event: ${event.type}`);
  }

  if (!changed) return { state, effects };
  settle(afterTimers, s, event.now, effects);
  return { state: s, effects };
}

// ─── internals (all mutate the working copy `s`) ────────────────────────────

function earliestTimer(timers) {
  let best = null;
  for (const t of timers) {
    if (!best || t.at < best.at || (t.at === best.at && t.id < best.id)) best = t;
  }
  return best;
}

function addTimer(s, kind, at, id = s.nextTimerId) {
  s.timers = [...s.timers, { id, kind, at }];
  if (id === s.nextTimerId) s.nextTimerId += 1;
}

function cancelTimers(s, kind) {
  if (s.timers.some(t => t.kind === kind)) s.timers = s.timers.filter(t => t.kind !== kind);
}

// Fire every timer due by `now`, earliest first, settling after each. Returns
// whether anything fired.
function advance(s, now, rng, effects) {
  let fired = false;
  for (;;) {
    const due = earliestTimer(s.timers);
    if (!due || due.at > now) return fired;
    const before = { ...s };
    s.timers = s.timers.filter(t => t !== due);
    fireTimer(s, due, rng);
    settle(before, s, due.at, effects);
    fired = true;
  }
}

function fireTimer(s, timer, rng) {
  const at = timer.at;
  switch (timer.kind) {
    case TIMER.SPAWN: {
      addTimer(s, TIMER.SPAWN, at + s.settings.spawnIntervalMs, timer.id);
      if (s.enemies.length >= maxEnemies(s)) break;
      const occupied = s.enemies.map(e => e.position);
      const position = pickSpawnPosition(s.muncher, occupied, rng);
      if (position === null) break;
      s.enemies = [...s.enemies, { id: s.nextEnemyId, position, facing: 'center', nextPosition: null }];
      s.nextEnemyId += 1;
      break;
    }
    case TIMER.ENEMY_PLAN: {
      addTimer(s, TIMER.ENEMY_PLAN, at + enemyInterval(s), timer.id);
      // Plan every monster's step, then settle conflicts so no two claim the
      // same cell: everyone starts holding their current cell, and a monster
      // only takes its target if no other monster's settled cell is already
      // there. Resolving in order lets two swap places but never stack, and a
      // monster won't step onto one that's staying put.
      const plans = s.enemies.map(e => planEnemyMove(e.position, s.muncher, rng, s.settings));
      const finals = s.enemies.map(e => e.position);
      for (let i = 0; i < finals.length; i++) {
        const target = plans[i].newPosition;
        if (!finals.some((pos, j) => j !== i && pos === target)) finals[i] = target;
      }
      s.enemies = s.enemies.map((e, i) => ({
        ...e,
        facing: finals[i] !== e.position ? plans[i].facing : 'center',
        nextPosition: finals[i],
      }));
      addTimer(s, TIMER.ENEMY_COMMIT, at + s.settings.enemyTelegraphMs);
      break;
    }
    case TIMER.ENEMY_COMMIT:
      // The planned cell stays recorded; a monster spawned since the plan
      // (nextPosition null) holds its cell.
      s.enemies = s.enemies.map(e => ({
        ...e,
        position: e.nextPosition ?? e.position,
        facing: 'center',
      }));
      break;
    case TIMER.CAUGHT_END: {
      // Dock a life, send the muncher back to the start, and clear away the
      // monster(s) that got it.
      const caughtAt = s.caughtAt;
      loseLife(s);
      s.muncher = START_CELL;
      s.enemies = s.enemies.filter(e => e.position !== caughtAt);
      s.caughtAt = null;
      break;
    }
    default:
      throw new Error(`unknown munchers timer: ${timer.kind}`);
  }
}

function loseLife(s) {
  s.lives -= 1;
  if (s.lives <= 0) s.gameOver = true;
}

// After a change prev → s at `now`: catch the muncher if it shares a cell with
// a monster, report a game that just ended, and start or stop the clocks.
function settle(prev, s, now, effects) {
  if (!isFrozen(s) && s.enemies.some(e => e.position === s.muncher)) {
    effects.push({ type: 'sound', sound: 'caught' });
    s.caughtAt = s.muncher;
    addTimer(s, TIMER.CAUGHT_END, now + s.settings.caughtBeatMs);
  }
  if (s.gameOver && !prev.gameOver) {
    if (s.score > s.highScore) {
      s.isNewHighScore = true;
      s.highScore = s.score;
      effects.push({ type: 'saveHighScore', score: s.score });
    }
    effects.push({ type: 'gameOver', score: s.score });
  }
  syncClocks(prev, s, now);
}

function syncClocks(prev, s, now) {
  const runs = !isFrozen(s);
  const ran = !isFrozen(prev);
  if (!runs) {
    if (ran) {
      cancelTimers(s, TIMER.SPAWN);
      cancelTimers(s, TIMER.ENEMY_PLAN);
      cancelTimers(s, TIMER.ENEMY_COMMIT);
    }
    return;
  }
  if (!ran || maxEnemies(prev) !== maxEnemies(s)) {
    cancelTimers(s, TIMER.SPAWN);
    addTimer(s, TIMER.SPAWN, now + s.settings.spawnIntervalMs);
  }
  if (!ran || enemyInterval(prev) !== enemyInterval(s)) {
    cancelTimers(s, TIMER.ENEMY_PLAN);
    cancelTimers(s, TIMER.ENEMY_COMMIT);
    addTimer(s, TIMER.ENEMY_PLAN, now + enemyInterval(s));
  }
}

function move(s, direction) {
  if (!s.started || s.gameOver) return false;
  const next = stepFrom(s.muncher, direction);
  if (next === s.muncher) return false;
  s.muncher = next;
  return true;
}

function eat(s, rng, effects) {
  if (isFrozen(s)) return false;
  if (s.eaten.includes(s.muncher)) return false;
  const value = s.board[s.muncher];
  if (value === null) return false;

  s.eaten = [...s.eaten, s.muncher];
  const base = currentBase(s);
  if (isCorrectValue(s, value)) {
    effects.push({ type: 'sound', sound: 'correct' });
    s.score += pointsForBase(base, s.settings);
    s.correctEaten += 1;
    const emoji = BABY_DRAGON_EMOJIS[Math.floor(rng() * BABY_DRAGON_EMOJIS.length)];
    s.babyDragons = [...s.babyDragons, { id: `${s.level}-${s.correctEaten}`, emoji }];
    // Cleared the board: either on to the next level, or that's the game.
    if (s.correctEaten === totalCorrect(s)) {
      if (s.progression && s.level < s.levels.length - 1) s.levelTransition = true;
      else s.gameOver = true;
    }
  } else {
    effects.push({ type: 'sound', sound: 'wrong' });
    s.wrongAnswer = { operation: s.operation, baseNumber: base, value };
  }
  return true;
}

function tapCell(s, cell, rng, effects) {
  if (isFrozen(s)) return false;
  if (cell === s.muncher) return eat(s, rng, effects);
  const rowDiff = rowOf(cell) - rowOf(s.muncher);
  const colDiff = colOf(cell) - colOf(s.muncher);
  // Only orthogonal neighbours; anything else is ignored.
  if (Math.abs(rowDiff) + Math.abs(colDiff) !== 1) return false;
  if (rowDiff < 0) return move(s, 'up');
  if (rowDiff > 0) return move(s, 'down');
  if (colDiff < 0) return move(s, 'left');
  return move(s, 'right');
}

// Next base number: a fresh board, keeping lives and score.
function advanceLevel(s, rng) {
  const oldBase = currentBase(s);
  s.level += 1;
  s.muncher = START_CELL;
  s.enemies = [];
  s.eaten = [];
  s.correctEaten = 0;
  s.babyDragons = [];
  s.wrongAnswer = null;
  s.levelTransition = false;
  if (currentBase(s) !== oldBase) s.board = generateBoard(s.operation, currentBase(s), rng);
}

// The game's props changed under it. Mirrors the web's memoised levels (keyed
// on progression and baseNumber) and board (keyed on operation and the current
// base); nothing else resets.
function configChanged(s, { operation, baseNumber, progression }, rng) {
  const oldBase = currentBase(s);
  const oldOperation = s.operation;
  let changed = false;
  if (progression !== s.progression || baseNumber !== s.baseNumber) {
    s.levels = buildLevels(progression, baseNumber, rng, s.settings);
    s.progression = progression;
    s.baseNumber = baseNumber;
    changed = true;
  }
  if (operation !== oldOperation) {
    s.operation = operation;
    changed = true;
  }
  if (operation !== oldOperation || currentBase(s) !== oldBase) {
    s.board = generateBoard(operation, currentBase(s), rng);
  }
  return changed;
}
