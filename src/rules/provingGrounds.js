// Proving Grounds rules — a timed drill that "proves" a kid's times-tables (and
// the matching division facts) for a single digit 2-9. Every fact in the set is
// asked twice; a bronze/silver/gold medal is awarded on finish time + accuracy.
//
// Set for digit d, multiplication:  1×d, 2×d, … 12×d   (answers d … 12d)
// Set for digit d, division:        d÷d, 2d÷d, … 12d÷d (answers 1 … 12)
// Each of the 12 facts is asked twice → 24 problems per run.
//
// Pure: the shuffle takes an injected rng and the timer an injected clock, so
// a run from a fixed seed is repeatable and golden/proving-grounds.json can pin
// it for the Swift port (ADR 0005). The defaults (Math.random, performance.now)
// are what the web uses. Per-kid medal storage stays in src/utils/provingGrounds.js.

export const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9];

export const MODES = [
  { key: 'mul', label: 'Multiplication', symbol: '×', color: '#d97474', blurb: 'prove your times tables' },
  { key: 'div', label: 'Division',       symbol: '÷', color: '#d4a957', blurb: 'prove your sharing facts' },
];
export const MODE_BY_KEY = Object.fromEntries(MODES.map(m => [m.key, m]));

// Seconds thresholds. Gold/silver require a perfect run; bronze allows one slip.
export const THRESHOLDS = { gold: 45, silver: 60, bronze: 90 };
export const MAX_WRONG_FOR_BRONZE = 1;

export const MEDALS = {
  gold:   { label: 'Gold',   icon: '🥇', color: '#e8b923' },
  silver: { label: 'Silver', icon: '🥈', color: '#aab2bd' },
  bronze: { label: 'Bronze', icon: '🥉', color: '#c08457' },
};
// Ranked worst → best so we only ever overwrite a saved medal with a better one.
export const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };

// Fisher-Yates from the end, one rng draw per step (11 draws for 12 items).
// The Swift port must consume draws in exactly this order.
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The 12 facts for a digit, in listed order (1×d … 12×d / d÷d … 12d÷d).
function baseFacts(mode, digit) {
  const facts = [];
  for (let i = 1; i <= 12; i++) {
    if (mode === 'div') {
      const dividend = i * digit;
      facts.push({ a: dividend, b: digit, op: 'div', answer: i, prompt: `${dividend} ÷ ${digit}` });
    } else {
      facts.push({ a: i, b: digit, op: 'mul', answer: i * digit, prompt: `${i} × ${digit}` });
    }
  }
  return facts;
}

// Every fact is asked twice, in a randomized order with no fact repeated
// back-to-back. Two independent shuffles of the 12 facts form the two halves —
// each fact appears once per half, so duplicates can only ever meet at the seam
// between the halves, which we swap away. The result: 24 problems, each fact
// twice, fully mixed, never consecutive.
export function buildProblemSet(mode, digit, rng = Math.random) {
  const first = shuffle(baseFacts(mode, digit), rng);
  const second = shuffle(baseFacts(mode, digit), rng);
  const seam = first[first.length - 1];
  if (second[0].prompt === seam.prompt) {
    const i = second.findIndex(f => f.prompt !== seam.prompt);
    [second[0], second[i]] = [second[i], second[0]];
  }
  return [...first, ...second];
}

// Which medal (if any) a run earns. Order matters — check strongest first.
// Thresholds are inclusive: finishing in exactly 45.0s is still gold.
export function awardMedal(elapsedSec, wrongCount) {
  if (wrongCount === 0 && elapsedSec <= THRESHOLDS.gold) return 'gold';
  if (wrongCount === 0 && elapsedSec <= THRESHOLDS.silver) return 'silver';
  if (wrongCount <= MAX_WRONG_FOR_BRONZE && elapsedSec <= THRESHOLDS.bronze) return 'bronze';
  return null;
}

// Seconds between two clock readings in milliseconds, never negative (the
// first on-screen tick can land a hair before the recorded start).
export function elapsedSeconds(startMs, nowMs) {
  return Math.max(0, (nowMs - startMs) / 1000);
}

// A run's stopwatch over an injected millisecond clock. start() pins the
// start reading; elapsedSec() reads the clock again. The web passes nothing and
// gets performance.now (monotonic, so a wall-clock change can't skew a medal).
export function createDrillTimer(clock = () => performance.now()) {
  let startMs = 0;
  return {
    start() {
      startMs = clock();
      return startMs;
    },
    get startMs() {
      return startMs;
    },
    elapsedSec(nowMs = clock()) {
      return elapsedSeconds(startMs, nowMs);
    },
  };
}
