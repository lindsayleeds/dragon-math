// A seeded random number generator (SplitMix64) that the game rules can take in
// place of Math.random, so a rule run from a fixed seed is repeatable.
//
// Why this exists: the iOS app decides battle outcomes and prize draws on the
// device (ADR 0004), so the same rules live in JavaScript and in Swift. They are
// kept identical by golden files (ADR 0005): scripts/generate-golden.mjs runs the
// JavaScript rules from fixed seeds, and the Swift GameRules tests must reproduce
// the output exactly. That only works if both languages draw the same numbers,
// so the algorithm here is the reference — the Swift port must match it bit for
// bit, and golden/prng.json is the check that it does.
//
// SplitMix64 was picked for being tiny and easy to port exactly: one 64-bit
// state word, an add and three xor-shift-multiply steps, no tables. The 64-bit
// arithmetic uses BigInt because a JS number cannot hold it; BigInt.asUintN(64)
// is the wrapping `&+` / `&*` that Swift's UInt64 does natively.
//
// Plain ESM with no browser or Node APIs, so it bundles into the web app and
// can also be `require()`d from the CommonJS server on Node 22.12+.

const MASK = 64;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MIX_1 = 0xbf58476d1ce4e5b9n;
const MIX_2 = 0x94d049bb133111ebn;
// 2^-53: the top 53 bits of an output, scaled, give every double in [0, 1)
// on an even 2^-53 grid — the same construction Swift uses for Double.random.
const FLOAT_SCALE = 2 ** -53;

// Accepts a non-negative safe integer, a BigInt, or a decimal/0x string, and
// wraps it to 64 bits, so a seed stored as a string in JSON round-trips.
function toSeed(seed) {
  if (typeof seed === 'number' && !Number.isSafeInteger(seed)) {
    throw new RangeError(`seed must be a safe integer, got ${seed}`);
  }
  return BigInt.asUintN(MASK, BigInt(seed));
}

// createSeededRandom(seed) → { next, nextUint64 }
//   next()        float in [0, 1), a drop-in for Math.random
//   nextUint64()  the raw 64-bit output as a BigInt, for exact comparison
// Both advance the same state, so interleaving them is still deterministic.
// The methods are closures, so `const rand = rng.next` can be passed around
// unbound wherever a rule expects a `() => number`.
export function createSeededRandom(seed) {
  let state = toSeed(seed);

  function nextUint64() {
    state = BigInt.asUintN(MASK, state + GOLDEN_GAMMA);
    let z = state;
    z = BigInt.asUintN(MASK, (z ^ (z >> 30n)) * MIX_1);
    z = BigInt.asUintN(MASK, (z ^ (z >> 27n)) * MIX_2);
    return z ^ (z >> 31n);
  }

  function next() {
    return Number(nextUint64() >> 11n) * FLOAT_SCALE;
  }

  return { next, nextUint64 };
}
