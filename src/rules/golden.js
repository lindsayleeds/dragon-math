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

// filename (relative to golden/) → fixture object. Later rule tickets add
// their fixtures here.
export function buildGoldenFiles() {
  return {
    'prng.json': prngFixture(),
  };
}

// The exact bytes written to disk, so the script and the drift test agree.
export function serializeGolden(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
