// Stepping Stones rules — skip counting across a stream. The otter crosses
// NUM_STONES rocks; hop i (1-based) asks for baseNumber × i, offered among
// CHOICES_PER_HOP lily pads, and a wrong pad sends the run back to the start.
//
// Pure: the shuffles take an injected rng (`() => number` in [0, 1), default
// Math.random), so a crossing from a fixed seed is repeatable and
// golden/stepping-stones.json can pin it for the Swift port (ADR 0005).
// src/components/SteppingStones.jsx owns the UI: pad placement around the
// target rock, animation timings, the run timer and the leaderboard.
//
// Draw order (the Swift port must consume draws in exactly this order):
// generateHops draws hop by hop, i = 1 … NUM_STONES, and for each hop
//   1. shuffles its distractor pool (built in candidate order, see below) —
//      pool.length - 1 draws — and keeps the first CHOICES_PER_HOP - 1;
//   2. shuffles [correct, ...kept distractors] — CHOICES_PER_HOP - 1 draws
//      for a full set (one fewer per missing distractor).
// Every shuffle is Fisher-Yates from the end: j = floor(rng() * (i + 1)) for
// i = length - 1 down to 1. buildPath draws nothing.

export const NUM_STONES = 10;
export const CHOICES_PER_HOP = 4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Fisher-Yates from the end, one rng draw per step.
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A zig-zag path of stones drifting from the left bank toward the right bank
// as it descends the vertical stream. Positions are percentages of the stream.
export function buildPath(n = NUM_STONES) {
  const positions = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1); // 0..1 progress down the stream
    const xBase = 22 + t * 56; // overall left -> right drift
    const zig = (i % 2 === 0 ? -1 : 1) * 8; // alternating zig-zag
    positions.push({
      x: clamp(xBase + zig, 16, 84),
      y: clamp(10 + t * 78, 8, 90),
    });
  }
  return positions;
}

// The distractor candidates for a hop, in the order the pool is built from:
// off-by-one/two skip-count slips and the tempting "over-skip" to the multiple
// after the target. Non-positive values, the answer itself, multiples already
// locked in on earlier stones and repeats are dropped.
export function distractorPool(baseNumber, i) {
  const target = baseNumber * i;
  const previous = new Set(
    Array.from({ length: i - 1 }, (_, k) => baseNumber * (k + 1))
  );
  const candidates = [
    target + 1,
    target - 1,
    target + 2,
    target - 2,
    target + baseNumber, // over-skip: the multiple *after* this one
    target + baseNumber + 1,
  ];
  const pool = [];
  for (const c of candidates) {
    if (c > 0 && c !== target && !previous.has(c) && !pool.includes(c)) {
      pool.push(c);
    }
  }
  return pool;
}

// Each hop offers the correct next multiple alongside plausible distractors.
// The kid has to work out which pad is the true next multiple.
export function generateHops(baseNumber, rng = Math.random) {
  const hops = [];
  for (let i = 1; i <= NUM_STONES; i++) {
    const target = baseNumber * i;
    const distractors = shuffle(distractorPool(baseNumber, i), rng).slice(0, CHOICES_PER_HOP - 1);
    const choices = shuffle([
      { value: target, isCorrect: true },
      ...distractors.map((value) => ({ value, isCorrect: false })),
    ], rng);
    hops.push({ target, choices });
  }
  return hops;
}
