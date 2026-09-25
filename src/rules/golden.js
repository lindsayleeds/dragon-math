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
//   - A fixture whose rules read tunables records them under `settings`: the
//     rule-settings schema_version plus the served section(s), exactly as
//     GET /api/rule-settings serves them (see ./goldenSettings.js). Cases run
//     on other values record their own served section beside them.
//
// Pure data. The fixture builders may use Node APIs (phonicsGolden.js loads a
// CommonJS server module with createRequire): only the generator script and the
// vitest drift test import this, both on Node — never the web bundle.

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
import { drawDragonPrize, rollPrizeCount } from '../data/dragonPrize.js';
import {
  DEFAULT_EGG_HATCHERY_SETTINGS,
  DEFAULT_PRIZE_SETTINGS,
  DEFAULT_PROVING_GROUNDS_SETTINGS,
  DEFAULT_STEPPING_STONES_SETTINGS,
  DEFAULT_TRIAL_SETTINGS,
  eggHatcherySettingsFromServer,
  prizeSettingsFromServer,
  provingGroundsSettingsFromServer,
  steppingStonesSettingsFromServer,
  trialSettingsFromServer,
} from '../data/ruleSettings.js';
import { goldenSettings, tunedSettings } from './goldenSettings.js';
import { DRAGON_PNG_COUNT } from '../data/dragonRarity.js';
import {
  createTrialState,
  nextProblem,
  skipProblem,
  startProblemClock,
  tapAnswer,
  computeTrialOutcome,
} from './dragonTrial.js';
import {
  buildProblemSet,
  awardMedal,
  elapsedSeconds,
} from './provingGrounds.js';
import { phonicsFixture } from './phonicsGolden.js';
import {
  buildAnswerChoices,
  calculateMasteryTier,
  generateAnswerButtons,
  generateProblems,
  getHintText,
  hintOfferDelayMs,
  pickDragonId,
} from './eggHatchery.js';
import { buildPath, generateHops } from './steppingStones.js';
import { battleTranscriptsFixture } from './battleTranscripts.js';
import { spellingFixture } from './spellingGolden.js';
import { memorizeFixture } from './memorizeGolden.js';
import { ruleSettingsFixture } from './ruleSettingsGolden.js';
import { munchersFixture } from './munchersTranscripts.js';
import { companionsFixture } from './companionsGolden.js';
import { bossBattlesFixture } from './bossBattleGolden.js';

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
// ── Prize draws (src/data/dragonPrize.js) ────────────────────────────────────

const PRIZE_SEEDS = ['0', '1', '7', '42', '2024', '9007199254740991', '18446744073709551615'];
const PRIZE_DRAWS = 12;
// One long run with the real table, so the rarest tiers (mythic is ~0.35% of
// draws) show up under default weights too.
const PRIZE_LONG_RUN = { catalog: 'all_tiers', seed: '42', count: 1000 };

// Catalog rows as the API serves them. Only dragon_id and rarity matter to the
// draw; names are left out.
const row = (dragon_id, rarity) => ({ dragon_id, rarity });

const PRIZE_CATALOGS = {
  // Every tier, several dragons each, listed weakest → strongest.
  all_tiers: [
    row(1, 'common'), row(2, 'common'), row(3, 'common'), row(4, 'common'),
    row(5, 'uncommon'), row(6, 'uncommon'), row(7, 'uncommon'),
    row(8, 'rare'), row(9, 'rare'),
    row(10, 'very_rare'), row(11, 'very_rare'),
    row(12, 'legendary'), row(13, 'legendary'),
    row(14, 'mythic'),
  ],
  // The same dragons, strongest first and interleaved: tier order and in-tier
  // order both follow first appearance in the catalog, so this draws differently.
  all_tiers_shuffled: [
    row(14, 'mythic'), row(3, 'common'), row(12, 'legendary'), row(8, 'rare'),
    row(1, 'common'), row(10, 'very_rare'), row(6, 'uncommon'), row(4, 'common'),
    row(13, 'legendary'), row(5, 'uncommon'), row(2, 'common'), row(9, 'rare'),
    row(11, 'very_rare'), row(7, 'uncommon'),
  ],
  // Empty tiers (no uncommon, rare, very_rare or mythic) are never drawn.
  empty_tiers: [
    row(20, 'common'), row(21, 'common'), row(22, 'legendary'),
  ],
  // Only the rarest tier present: every draw is a mythic.
  mythic_only: [row(30, 'mythic'), row(31, 'mythic'), row(32, 'mythic')],
  single_dragon: [row(40, 'rare')],
  // A missing rarity is 'common'; one not in the weight table weighs 1.
  missing_and_unknown_rarity: [
    row(50, null), row(51, 'common'), row(52, 'sparkly'), row(53, 'mythic'),
  ],
  // An empty catalog (or none at all, e.g. the fetch failed) falls back to the
  // legacy art range 1…DRAGON_PNG_COUNT, all common.
  empty: [],
};

const PRIZE_RARITY_TABLES = {
  default: DEFAULT_PRIZE_SETTINGS.rarityWeights,
  flat: { common: 1, uncommon: 1, rare: 1, very_rare: 1, legendary: 1, mythic: 1 },
  mythic_heavy: { common: 1, uncommon: 2, rare: 4, very_rare: 8, legendary: 16, mythic: 32 },
  // A zero weight never wins (except on a draw of exactly 0, if listed first).
  no_common: { common: 0, uncommon: 45, rare: 18, very_rare: 6, legendary: 2, mythic: 0.6 },
};

// One `draws` case: `catalog` names a PRIZE_CATALOGS entry, or is null for the
// no-catalog-loaded fallback.
function prizeDrawCase(catalog, rarityTable, seed, count) {
  const rng = createSeededRandom(BigInt(seed)).next;
  const rows = catalog === null ? null : PRIZE_CATALOGS[catalog];
  const settings = { ...DEFAULT_PRIZE_SETTINGS, rarityWeights: PRIZE_RARITY_TABLES[rarityTable] };
  const drawn = drawDragonPrize(rows, count, rng, settings);
  return { catalog, rarityTable, seed, count, drawn: drawn.map(d => d.dragon_id) };
}

// Non-default count weights, for `tunedCountRolls`.
const PRIZE_TUNED = tunedSettings('prize', prizeSettingsFromServer, {
  count_weights: {
    low: [{ count: 1, weight: 1 }],
    normal: [{ count: 2, weight: 1 }, { count: 4, weight: 1 }],
    high: [{ count: 5, weight: 3 }, { count: 1, weight: 0 }, { count: 3, weight: 1 }],
  },
});

function prizeDrawsFixture() {
  const { countWeights } = DEFAULT_PRIZE_SETTINGS;
  const draws = [];
  for (const catalog of Object.keys(PRIZE_CATALOGS)) {
    for (const rarityTable of Object.keys(PRIZE_RARITY_TABLES)) {
      // The fallback is all common, so every table draws alike: record one.
      if (catalog === 'empty' && rarityTable !== 'default') continue;
      for (const seed of PRIZE_SEEDS) draws.push(prizeDrawCase(catalog, rarityTable, seed, PRIZE_DRAWS));
    }
  }
  for (const seed of PRIZE_SEEDS) draws.push(prizeDrawCase(null, 'default', seed, PRIZE_DRAWS));
  for (const seed of PRIZE_SEEDS) draws.push(prizeDrawCase('all_tiers', 'default', seed, 0));
  draws.push(prizeDrawCase(PRIZE_LONG_RUN.catalog, 'default', PRIZE_LONG_RUN.seed, PRIZE_LONG_RUN.count));

  return {
    fixture: 'prize-draws',
    version: 2,
    description:
      'Dragon prize draws from src/data/dragonPrize.js, each case from a fresh createSeededRandom(seed).next. ' +
      '`settings`: the served `prize` section every case uses unless it says otherwise (count_weights entries ' +
      'are {count, weight}, walked in order). ' +
      '`countRolls`: rollPrizeCount(performance, rng) called `counts.length` times on one generator. ' +
      '`tunedCountRolls`: the same under tunedCountRolls.settings (a served `prize` section). ' +
      '`draws`: drawDragonPrize(catalogs[catalog], count, rng) with the rarity weights replaced by ' +
      'rarityTables[rarityTable] (`default` = settings.prize.rarity_weights) → dragon_ids. ' +
      'Each dragon consumes two draws: a rarity pick over the tiers present in the catalog, in order of first ' +
      'appearance, then Math.floor(next * tierSize) within that tier in catalog order. A null rarity is ' +
      "'common'; a rarity missing from the table weighs 1; an empty catalog (or null) falls back to dragon_ids " +
      '1…fallbackCatalogSize, all common. Weighted picks walk the entries in order, subtracting each weight from ' +
      'next * total and taking the first entry where the remainder is <= 0. ' +
      '`prizes`: the full end-of-game flow on ONE generator — rollPrizeCount then drawDragonPrize(catalog, count, rng) ' +
      'with the default table. Duplicates within a prize are allowed; ownership plays no part in the draw.',
    settings: goldenSettings({ prize: [prizeSettingsFromServer, DEFAULT_PRIZE_SETTINGS] }),
    fallbackCatalogSize: DRAGON_PNG_COUNT,
    catalogs: PRIZE_CATALOGS,
    rarityTables: PRIZE_RARITY_TABLES,
    countRolls: prizeCountRolls(countWeights, DEFAULT_PRIZE_SETTINGS),
    tunedCountRolls: {
      settings: PRIZE_TUNED.served,
      rolls: prizeCountRolls(countWeights, PRIZE_TUNED.settings),
    },
    draws,
    prizes: ['all_tiers', 'empty_tiers', 'single_dragon'].flatMap(catalog =>
      Object.keys(countWeights).flatMap(performance =>
        PRIZE_SEEDS.map(seed => {
          const rng = createSeededRandom(BigInt(seed)).next;
          const count = rollPrizeCount(performance, rng);
          const drawn = drawDragonPrize(PRIZE_CATALOGS[catalog], count, rng).map(d => d.dragon_id);
          return { catalog, performance, seed, count, drawn };
        }),
      ),
    ),
  };
}

function prizeCountRolls(countWeights, settings) {
  return [...Object.keys(countWeights), 'unknown_tier'].flatMap(performance =>
    PRIZE_SEEDS.map(seed => {
      const rng = createSeededRandom(BigInt(seed)).next;
      const counts = Array.from({ length: PRIZE_DRAWS }, () => rollPrizeCount(performance, rng, settings));
      return { performance, seed, counts };
    }),
  );
}

// ─── Dragon's Trial ──────────────────────────────────────────────────────────
//
// Whole trial runs from a seed and a scripted child. The script is a policy
// (how this child answers a given op), but the fixture records the flat list
// of answers it produced, so Swift replays answers, not policies.

const TRIAL_BLANK_MS = 400;

// Answer shapes: { skip: true } | { wrong: 2 } | { wrong: 0 | 1, elapsedMs }.
const FAST = { wrong: 0, elapsedMs: 2500 };
const SKIP = { skip: true };
const cycle = list => (op, nth) => list[nth % list.length];
const byOp = map => (op, nth) => map[op](op, nth);
const always = answer => () => answer;

const TRIAL_RUNS = [
  { name: 'gives up on every problem', seed: '1', policy: always(SKIP) },
  {
    name: 'fluent at addition only',
    seed: '2',
    policy: byOp({ add: always(FAST), sub: always(SKIP), mul: always(SKIP), div: always(SKIP) }),
  },
  {
    name: 'fluent at addition, uncertain at subtraction, strong after',
    seed: '3',
    policy: byOp({
      add: always(FAST),
      sub: always({ wrong: 1, elapsedMs: 3000 }),
      mul: always(FAST),
      div: always(FAST),
    }),
  },
  {
    name: 'fluent at addition and subtraction, emerging at multiplication (TRIAL.md worked example)',
    seed: '4',
    policy: byOp({
      add: always(FAST),
      sub: always(FAST),
      mul: cycle([{ wrong: 1, elapsedMs: 5000 }, { wrong: 2 }, { wrong: 0, elapsedMs: 15000 }]),
      div: always(SKIP),
    }),
  },
  {
    name: 'fluent throughout',
    seed: '42',
    policy: cycle([{ wrong: 0, elapsedMs: 0 }, { wrong: 0, elapsedMs: 1200 }, { wrong: 0, elapsedMs: 4000 }]),
  },
  {
    name: 'fluent at the three core ops, weak at division',
    seed: '18446744073709551615',
    policy: byOp({ add: always(FAST), sub: always(FAST), mul: always(FAST), div: always(SKIP) }),
  },
  { name: 'borderline everywhere', seed: '7', policy: always({ wrong: 1, elapsedMs: 6000 }) },
  {
    name: 'correct but slow, across every speed-band edge',
    seed: '9',
    policy: (op, nth, i) => [4000, 4001, 8000, 8001, 12000, 12001]
      .map(elapsedMs => ({ wrong: 0, elapsedMs }))[i % 6],
  },
  {
    name: 'fails addition, strong elsewhere',
    seed: '11',
    policy: byOp({ add: always(SKIP), sub: always(FAST), mul: always(FAST), div: always(FAST) }),
  },
  {
    // Every trial tunable moved, so a port that hardcodes any one of them fails.
    name: 'tuned settings: shorter baseline, three attempts, other bands and nodes',
    seed: '13',
    policy: cycle([
      { wrong: 2, elapsedMs: 1500 },
      { wrong: 0, elapsedMs: 900 },
      { wrong: 1, elapsedMs: 2600 },
      { wrong: 3 },
      { skip: true },
      { wrong: 0, elapsedMs: 6000 },
    ]),
    tuned: {
      baseline_per_op: 2,
      probe_uncertain: 3,
      probe_confirm: 1,
      probe_strong_min_score: 700,
      probe_weak_below_score: 300,
      max_total_problems: 14,
      range_min: 3,
      range_max: 6,
      unique_retries: 4,
      first_try_points: 120,
      second_try_points: 80,
      max_attempts: 3,
      speed_bands: [{ max_ms: 1000, mult: 1 }, { max_ms: 2500, mult: 0.8 }, { max_ms: null, mult: 0.5 }],
      band_min_scores: { fluent: 600, capable: 450, developing: 300, emerging: 150 },
      op_start_node: { add: 2, sub: 18, mul: 27 },
      all_mastered_node: 35,
    },
  },
];

function playTrial({ name, seed, policy, tuned }) {
  const custom = tuned ? tunedSettings('trial', trialSettingsFromServer, tuned) : null;
  const settings = custom ? custom.settings : DEFAULT_TRIAL_SETTINGS;
  const rng = createSeededRandom(BigInt(seed)).next;
  let now = 0;
  const env = { rng, clock: () => now, settings };

  let state = startProblemClock(createTrialState(env), env);
  const asked = { add: 0, sub: 0, mul: 0, div: 0 };
  const answers = [];
  const questions = [];

  while (state.status === 'playing') {
    const { problem, phase, index } = state;
    const answer = policy(problem.op, asked[problem.op], index);
    asked[problem.op] += 1;
    answers.push(answer);

    if (answer.skip) {
      state = skipProblem(state);
    } else {
      for (let i = 0; i < answer.wrong; i++) state = tapAnswer(state, false, env);
      if (!state.resolved) {
        now += answer.elapsedMs;
        state = tapAnswer(state, true, env);
      }
    }
    const points = state.perOpPoints[problem.op].at(-1);
    questions.push({ index, phase, op: problem.op, a: problem.a, b: problem.b, answer: problem.answer, points });

    now += TRIAL_BLANK_MS;
    state = nextProblem(state, env);
  }

  return {
    name,
    seed,
    ...(custom ? { settings: custom.served } : {}),
    answers,
    questions,
    sequence: state.sequence,
    perOpPoints: state.perOpPoints,
    outcome: computeTrialOutcome(state.perOpPoints, settings),
  };
}

function trialFixture() {
  return {
    fixture: 'trial',
    version: 2,
    description:
      "Whole Dragon's Trial runs through src/rules/dragonTrial.js. Replay: rng = createSeededRandom(seed).next " +
      'and a fake clock starting at 0; state = startProblemClock(createTrialState). For each answer in order: ' +
      '{skip:true} → skipProblem; otherwise tapAnswer(wrong) `wrong` times at the unchanged clock, then, if not ' +
      'yet resolved, advance the clock by elapsedMs and tapAnswer(correct). Then advance the clock by ' +
      `${TRIAL_BLANK_MS} and call nextProblem, until status is complete. \`questions\` is each problem as posed ` +
      '(its index, phase, op, operands, answer) and the points it scored; `sequence` is the final op sequence ' +
      '(baseline + probe); `outcome` is computeTrialOutcome of the final perOpPoints. Every tunable comes from ' +
      '`settings` (the served `trial` section; env.settings = it converted, speed_bands max_ms null = no limit), ' +
      'except a run carrying its own `settings`, which replaces it for that run.',
    settings: goldenSettings({ trial: [trialSettingsFromServer, DEFAULT_TRIAL_SETTINGS] }),
    runs: TRIAL_RUNS.map(playTrial),
  };
}

// filename (relative to golden/) → fixture object. Later rule tickets add
// their fixtures here.
// Proving Grounds: one digit per seed so the fixture stays readable, both
// modes each. Seed 27 is included because its two halves collide at the seam,
// so it pins the swap that keeps a fact from being asked twice in a row.
const PROVING_GROUNDS_RUNS = [
  { seed: '0', digit: 2 },
  { seed: '1', digit: 5 },
  { seed: '42', digit: 7 },
  { seed: '27', digit: 9 },
];
// Either side of each threshold (they're inclusive), for a perfect run, one
// slip, and the two slips that forfeit any medal.
const PROVING_GROUNDS_TIMES = [0, 44.999, 45, 45.001, 59.999, 60, 60.001, 89.999, 90, 90.001, 300];
const PROVING_GROUNDS_WRONG = [0, 1, 2];
// [startMs, nowMs] clock readings; the last is a reading before the start.
const PROVING_GROUNDS_CLOCK = [[0, 0], [1000, 46000], [250.5, 60250.5], [12345.678, 102345.679], [500, 400]];

// Non-default medal settings, for `tunedMedals`.
const PROVING_GROUNDS_TUNED = tunedSettings('proving_grounds', provingGroundsSettingsFromServer, {
  medal_seconds: { gold: 30, silver: 45.5, bronze: 60 },
  max_wrong_for_bronze: 2,
});
const PROVING_GROUNDS_TUNED_TIMES = [29.999, 30, 30.001, 45.5, 45.501, 60, 60.001];
const PROVING_GROUNDS_TUNED_WRONG = [0, 1, 2, 3];

function medalCases(times, wrongs, settings) {
  return wrongs.flatMap(wrongCount =>
    times.map(elapsedSec => ({ elapsedSec, wrongCount, medal: awardMedal(elapsedSec, wrongCount, settings) })),
  );
}

function provingGroundsFixture() {
  return {
    fixture: 'proving-grounds',
    version: 2,
    description:
      'Proving Grounds rules (src/rules/provingGrounds.js). `problemSets`: buildProblemSet(mode, digit, rng) ' +
      'with rng = createSeededRandom(seed).next from a fresh generator — two Fisher-Yates shuffles of the 12 ' +
      'facts (11 draws each, j = floor(rng() * (i + 1)) for i = 11 down to 1), then the seam swap. ' +
      '`medals`: awardMedal(elapsedSec, wrongCount, settings) with `settings` the served `proving_grounds` ' +
      'section (medal_seconds are inclusive ceilings; gold and silver need 0 wrong, bronze at most ' +
      'max_wrong_for_bronze), null = no medal. `tunedMedals`: the same under tunedMedals.settings. ' +
      '`elapsed`: elapsedSeconds(startMs, nowMs).',
    settings: goldenSettings({
      proving_grounds: [provingGroundsSettingsFromServer, DEFAULT_PROVING_GROUNDS_SETTINGS],
    }),
    problemSets: PROVING_GROUNDS_RUNS.flatMap(({ seed, digit }) =>
      ['mul', 'div'].map(mode => ({
        seed,
        mode,
        digit,
        problems: buildProblemSet(mode, digit, createSeededRandom(BigInt(seed)).next),
      })),
    ),
    medals: medalCases(PROVING_GROUNDS_TIMES, PROVING_GROUNDS_WRONG, DEFAULT_PROVING_GROUNDS_SETTINGS),
    tunedMedals: {
      settings: PROVING_GROUNDS_TUNED.served,
      medals: medalCases(PROVING_GROUNDS_TUNED_TIMES, PROVING_GROUNDS_TUNED_WRONG, PROVING_GROUNDS_TUNED.settings),
    },
    elapsed: PROVING_GROUNDS_CLOCK.map(([startMs, nowMs]) => ({
      startMs,
      nowMs,
      elapsedSec: elapsedSeconds(startMs, nowMs),
    })),
  };
}

// ─── Egg Hatchery (src/rules/eggHatchery.js) ─────────────────────────────────
//
// Whole rounds on one generator, drawn in the order the component draws them:
// the problem shuffle, then per problem its answer buttons and hint delay, then
// the dragon it hatches into. The cases cover every operation, the edges of the
// base-number range, and subtraction's zero answer (base op base).

const EGG_SEEDS = ['1', '42', '18446744073709551615'];
const EGG_POOL = [5, 17, 42, 88, 203];
const EGG_ROUNDS = [
  { operation: 'mul', baseNumber: 7, pool: null },
  { operation: 'mul', baseNumber: 1, pool: EGG_POOL },
  { operation: 'mul', baseNumber: 12, pool: null },
  { operation: 'div', baseNumber: 3, pool: EGG_POOL },
  { operation: 'add', baseNumber: 4, pool: null },
  { operation: 'sub', baseNumber: 9, pool: EGG_POOL },
  { operation: 'sub', baseNumber: 5, pool: null },
];
// Correct answers whose ±5 window is clipped at 1, so fewer unique
// distractors exist and the pick loop's draw count changes.
const EGG_BUTTON_ANSWERS = [0, 1, 2, 3, 6, 144];
const EGG_HINTS = [
  { operation: 'mul', baseNumber: 7, multiplier: 3, hintLevel: 1 },
  { operation: 'mul', baseNumber: 4, multiplier: 12, hintLevel: 1 },
  { operation: 'mul', baseNumber: 2, multiplier: 14, hintLevel: 1 },
  { operation: 'mul', baseNumber: 7, multiplier: 3, hintLevel: 0 },
  { operation: 'add', baseNumber: 7, multiplier: 3, hintLevel: 1 },
];
const EGG_TIER_SECONDS = [0, 9.5, 14.999, 15, 24.999, 25, 39.999, 40, 59.9, 60, 61.5, 600];
// Non-default tier times and hint delay, for `tuned`.
const EGG_TUNED = tunedSettings('egg_hatchery', eggHatcherySettingsFromServer, {
  tier_seconds: { legendary: 10, gold: 20.5, silver: 30 },
  hint_delay_min_ms: 3000,
  hint_delay_spread_ms: 4500,
});
const EGG_TUNED_TIER_SECONDS = [9.999, 10, 20.499, 20.5, 29.999, 30];

function playEggRound({ operation, baseNumber, pool }, seed) {
  const rng = createSeededRandom(BigInt(seed)).next;
  const problems = generateProblems(operation, baseNumber, rng);
  const hatches = problems.map(problem => ({
    id: problem.id,
    choices: buildAnswerChoices(problem.correctAnswer, rng),
    hintDelayMs: hintOfferDelayMs(rng, DEFAULT_EGG_HATCHERY_SETTINGS),
    dragonId: pickDragonId(pool, rng),
  }));
  return { operation, baseNumber, pool, seed, problems, hatches };
}

function eggHatcheryFixture() {
  return {
    fixture: 'egg-hatchery',
    version: 2,
    description:
      'Dragon Egg Hatchery rules (src/rules/eggHatchery.js), each case from a fresh createSeededRandom(seed).next. ' +
      '`rounds`: generateProblems(operation, baseNumber, rng) (Fisher-Yates of the 12 problems, 11 draws), then for ' +
      'each problem in shuffled order on the SAME generator: buildAnswerChoices(correctAnswer, rng) ' +
      '(generateAnswerButtons then a Fisher-Yates of the buttons), hintOfferDelayMs(rng) = hint_delay_min_ms + ' +
      'next * hint_delay_spread_ms, pickDragonId(pool, rng) ' +
      '— null pool = the 1…fallbackDragonCount range. `buttons`: generateAnswerButtons(correctAnswer, rng) unshuffled ' +
      '(correct first). `hints`: getHintText(operation, baseNumber, multiplier, hintLevel, rng), null = no hint. ' +
      '`tiers`: calculateMasteryTier(elapsedSeconds) — tier and timeDisplay; a tier is earned UNDER its ' +
      'tier_seconds. Tunables from `settings` (the served `egg_hatchery` section); `tuned` repeats the tiers and ' +
      'one seed\'s hint delays under tuned.settings.',
    settings: goldenSettings({ egg_hatchery: [eggHatcherySettingsFromServer, DEFAULT_EGG_HATCHERY_SETTINGS] }),
    fallbackDragonCount: DRAGON_PNG_COUNT,
    rounds: EGG_ROUNDS.flatMap(round => EGG_SEEDS.map(seed => playEggRound(round, seed))),
    buttons: EGG_BUTTON_ANSWERS.flatMap(correctAnswer =>
      EGG_SEEDS.map(seed => ({
        correctAnswer,
        seed,
        buttons: generateAnswerButtons(correctAnswer, createSeededRandom(BigInt(seed)).next),
      })),
    ),
    hints: EGG_HINTS.flatMap(hint =>
      EGG_SEEDS.map(seed => {
        const { operation, baseNumber, multiplier, hintLevel } = hint;
        const rng = createSeededRandom(BigInt(seed)).next;
        return { ...hint, seed, text: getHintText(operation, baseNumber, multiplier, hintLevel, rng) };
      }),
    ),
    tiers: EGG_TIER_SECONDS.map(elapsedSeconds => {
      const { tier, timeDisplay } = calculateMasteryTier(elapsedSeconds, DEFAULT_EGG_HATCHERY_SETTINGS);
      return { elapsedSeconds, tier, timeDisplay };
    }),
    tuned: {
      settings: EGG_TUNED.served,
      seed: EGG_SEEDS[1],
      // hintOfferDelayMs(rng, settings) called hintDelaysMs.length times on one fresh generator.
      hintDelaysMs: (() => {
        const rng = createSeededRandom(BigInt(EGG_SEEDS[1])).next;
        return Array.from({ length: 6 }, () => hintOfferDelayMs(rng, EGG_TUNED.settings));
      })(),
      tiers: EGG_TUNED_TIER_SECONDS.map(elapsedSeconds => ({
        elapsedSeconds,
        tier: calculateMasteryTier(elapsedSeconds, EGG_TUNED.settings).tier,
      })),
    },
  };
}

// ─── Stepping Stones (src/rules/steppingStones.js) ───────────────────────────
//
// Base 1 and 2 are the edge cases: their slips collide with earlier multiples,
// so the distractor pool shrinks (base 1 offers only three pads).

const STONES_SEEDS = ['1', '42', '18446744073709551615'];
const STONES_BASES = [1, 2, 3, 5, 7, 9, 12];
// A shorter crossing with fewer pads, for `tuned`.
const STONES_TUNED = tunedSettings('stepping_stones', steppingStonesSettingsFromServer, {
  num_stones: 6,
  choices_per_hop: 3,
});

function stonesCrossings(bases, settings) {
  return bases.flatMap(baseNumber =>
    STONES_SEEDS.map(seed => ({
      baseNumber,
      seed,
      hops: generateHops(baseNumber, createSeededRandom(BigInt(seed)).next, settings),
    })),
  );
}

function steppingStonesFixture() {
  return {
    fixture: 'stepping-stones',
    version: 2,
    description:
      'Stepping Stones rules (src/rules/steppingStones.js). `crossings`: generateHops(baseNumber, rng) with ' +
      'rng = createSeededRandom(seed).next from a fresh generator — per hop i = 1…numStones, a Fisher-Yates of the ' +
      'distractor pool (candidates target+1, target-1, target+2, target-2, target+base, target+base+1, dropping ' +
      'non-positive, the target, earlier multiples and repeats), keep the first choicesPerHop-1, then a Fisher-Yates ' +
      'of [correct, ...kept]. `path`: buildPath(numStones), percent positions of the rocks (no draws). ' +
      'numStones and choicesPerHop are num_stones and choices_per_hop from `settings` (the served ' +
      '`stepping_stones` section); `tuned` repeats path and crossings under tuned.settings.',
    settings: goldenSettings({
      stepping_stones: [steppingStonesSettingsFromServer, DEFAULT_STEPPING_STONES_SETTINGS],
    }),
    path: buildPath(DEFAULT_STEPPING_STONES_SETTINGS.numStones),
    crossings: stonesCrossings(STONES_BASES, DEFAULT_STEPPING_STONES_SETTINGS),
    tuned: {
      settings: STONES_TUNED.served,
      path: buildPath(STONES_TUNED.settings.numStones),
      crossings: stonesCrossings([1, 4, 11], STONES_TUNED.settings),
    },
  };
}

export function buildGoldenFiles() {
  return {
    'prng.json': prngFixture(),
    'battle-problems.json': battleProblemsFixture(),
    'prize-draws.json': prizeDrawsFixture(),
    'trial.json': trialFixture(),
    'proving-grounds.json': provingGroundsFixture(),
    'phonics.json': phonicsFixture(),
    'battle-transcripts.json': battleTranscriptsFixture(),
    'egg-hatchery.json': eggHatcheryFixture(),
    'stepping-stones.json': steppingStonesFixture(),
    'spelling.json': spellingFixture(),
    'memorize.json': memorizeFixture(),
    'munchers.json': munchersFixture(),
    'rule-settings.json': ruleSettingsFixture(),
    'companions.json': companionsFixture(),
    'boss-battles.json': bossBattlesFixture(),
  };
}

// The exact bytes written to disk, so the script and the drift test agree.
export function serializeGolden(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
