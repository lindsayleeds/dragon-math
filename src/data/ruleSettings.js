// Game-wide rule tunables for everything except the battle (which has its own
// src/data/battleSettings.js): prize odds, Proving Grounds medals, the Dragon's
// Trial, Dragon Munchers, the Egg Hatchery, Stepping Stones and Memorize. Each
// is a top-level section of GET /api/rule-settings; server/lib/ruleSettings.js
// owns the served document (snake_case), and this file owns the web side
// (camelCase) — the DEFAULT_* fallbacks and the *FromServer converters.
//
// The DEFAULT_* objects are what the rules use until that response arrives, or
// when it fails or is missing a field. Each must equal the server's section
// exactly — server/lib/ruleSettings.test.js asserts it field by field — so a
// game played offline follows the same rules as one played online.
//
// The converters fall back FIELD BY FIELD, so a partial or older document still
// plays, and they refuse values a rule could not survive (a negative weight, a
// fractional problem count, an empty list) by keeping the fallback for that one
// field.
//
// Pure data and pure functions: the rule modules and the Node golden script
// import this, so it must not import React, the api client or anything
// browser-only, and relative imports keep their `.js` extensions.

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// ─── Defaults (must equal server/lib/ruleSettings.js) ───────────────────────

// src/data/dragonPrize.js
export const DEFAULT_PRIZE_SETTINGS = deepFreeze({
  // Relative draw weights per rarity (weakest → strongest). Higher = more
  // likely. Only rarities that actually have dragons in the catalog are picked.
  rarityWeights: {
    common: 100,
    uncommon: 45,
    rare: 18,
    very_rare: 6,
    legendary: 2,
    mythic: 0.6,
  },
  // How many dragons a prize contains, by performance tier, as
  // [count, weight] entries. A strong finish skews toward the full three.
  countWeights: {
    low: [[1, 70], [2, 25], [3, 5]],
    normal: [[1, 45], [2, 40], [3, 15]],
    high: [[1, 20], [2, 45], [3, 35]],
  },
});

// src/rules/provingGrounds.js
export const DEFAULT_PROVING_GROUNDS_SETTINGS = deepFreeze({
  // Finish-time ceilings in seconds, inclusive. Gold and silver need a perfect
  // run; bronze allows up to maxWrongForBronze slips.
  medalSeconds: { gold: 45, silver: 60, bronze: 90 },
  maxWrongForBronze: 1,
});

// src/rules/dragonTrial.js (docs/TRIAL.md)
export const DEFAULT_TRIAL_SETTINGS = deepFreeze({
  // Baseline: this many problems per op (add, sub, mul, div), shuffled.
  baselinePerOp: 3,
  // Probe: an "uncertain" op gets probeUncertain more problems, a "strong" one
  // probeConfirm. Strong = baseline score >= probeStrongMinScore; weak = below
  // probeWeakBelowScore; anything between is uncertain.
  probeUncertain: 5,
  probeConfirm: 2,
  probeStrongMinScore: 800,
  probeWeakBelowScore: 400,
  // Hard cap on baseline + probe problems.
  maxTotalProblems: 50,
  // Operand range every trial problem draws from.
  rangeMin: 2,
  rangeMax: 10,
  // Attempts at a not-yet-asked problem before settling for a repeat.
  uniqueRetries: 25,
  // Points for a correct tap on the first / second try (then scaled by speed);
  // the maxAttempts-th wrong tap scores 0.
  firstTryPoints: 200,
  secondTryPoints: 150,
  maxAttempts: 2,
  // Speed multiplier on a correct answer, by ms from display to the tap. The
  // first band whose maxMs the time is within wins; the last is open-ended.
  speedBands: [
    { maxMs: 4000, mult: 1.0 },
    { maxMs: 8000, mult: 0.9 },
    { maxMs: 12000, mult: 0.75 },
    { maxMs: Infinity, mult: 0.6 },
  ],
  // Lowest normalized score (0–1000) for each confidence band; below
  // `emerging` is not_ready.
  bandMinScores: { fluent: 850, capable: 700, developing: 500, emerging: 300 },
  // Placement: the start node of the first op not mastered, or
  // allMasteredNode when add, sub and mul are all fluent.
  opStartNode: { add: 1, sub: 17, mul: 26 },
  allMasteredNode: 34,
  // Atmospheric growl: growlMs ± (growlJitterFraction / 2), never under
  // growlMinMs.
  growlMs: 12000,
  growlJitterFraction: 0.3,
  growlMinMs: 4000,
});

// src/rules/munchers.js
export const DEFAULT_MUNCHERS_SETTINGS = deepFreeze({
  startingLives: 3,
  // Points per correct answer: bases up to easyMaxBase are worth easyPoints,
  // the harder ones hardPoints.
  easyMaxBase: 5,
  easyPoints: 5,
  hardPoints: 10,
  enemyMoveIntervalMs: 3000,
  // How long a monster "looks" toward its next cell before it moves.
  enemyTelegraphMs: 750,
  spawnIntervalMs: 4000,
  // How long the gobble animation plays before the life is lost.
  caughtBeatMs: 1000,
  // Share of moves where a monster chases the muncher rather than wandering.
  chaseChance: 0.6,
  // Progression campaign: the easy bases in a random order, then the hard ones.
  progressionEasy: [2, 3, 4, 5],
  progressionHard: [6, 7, 8, 9],
  // Monsters speed up by enemySpeedupPerLevelMs a level (never faster than
  // minEnemyIntervalMs), and one more joins every levelsPerExtraEnemy levels
  // (at most maxEnemies).
  enemySpeedupPerLevelMs: 220,
  minEnemyIntervalMs: 1100,
  levelsPerExtraEnemy: 3,
  maxEnemies: 3,
});

// src/rules/eggHatchery.js
export const DEFAULT_EGG_HATCHERY_SETTINGS = deepFreeze({
  // Seconds UNDER which each tier is earned; slower than silver is bronze.
  tierSeconds: { legendary: 15, gold: 25, silver: 40 },
  // A hint is offered after hintDelayMinMs + rng() * hintDelaySpreadMs.
  hintDelayMinMs: 5000,
  hintDelaySpreadMs: 2000,
});

// src/rules/steppingStones.js
export const DEFAULT_STEPPING_STONES_SETTINGS = deepFreeze({
  numStones: 10,
  choicesPerHop: 4,
});

// src/rules/memorize.js
export const DEFAULT_MEMORIZE_SETTINGS = deepFreeze({
  // Easy hides word i of sentence s when (i + s) % easyHideEvery === easyHideOffset.
  easyHideEvery: 4,
  easyHideOffset: 1,
});

// ─── Field validators ───────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegativeOr = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
const intAtLeastOr = (min) => (v, d) => (Number.isInteger(v) && v >= min ? v : d);
const countOr = intAtLeastOr(0);
const positiveIntOr = intAtLeastOr(1);
const fractionOr = (v, d) => (Number.isFinite(v) && v >= 0 && v <= 1 ? v : d);

// Every key of `defaults`, each from `served` when `check` accepts it.
function mapOr(served, defaults, check) {
  const src = isObject(served) ? served : {};
  return Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, check(src[k], d)]));
}

// A non-empty list where every entry passes `convert` (which returns
// undefined to reject one), else the fallback list.
function listOr(served, fallback, convert) {
  if (!Array.isArray(served) || served.length === 0) return fallback;
  const out = served.map(convert);
  return out.every((v) => v !== undefined) ? out : fallback;
}

// ─── Converters: /api/rule-settings document → runtime settings ─────────────

export function prizeSettingsFromServer(doc) {
  const d = DEFAULT_PRIZE_SETTINGS;
  const s = isObject(doc?.prize) ? doc.prize : {};
  // Served rarity weights may name a tier the fallback doesn't know yet; keep it.
  const rarityWeights = mapOr(s.rarity_weights, d.rarityWeights, nonNegativeOr);
  if (isObject(s.rarity_weights)) {
    for (const [k, v] of Object.entries(s.rarity_weights)) {
      if (!(k in rarityWeights) && Number.isFinite(v) && v >= 0) rarityWeights[k] = v;
    }
  }
  const countWeights = mapOr(s.count_weights, d.countWeights, (tier, fallback) =>
    listOr(tier, fallback, (e) =>
      (isObject(e) && Number.isInteger(e.count) && e.count >= 1 && Number.isFinite(e.weight) && e.weight >= 0
        ? [e.count, e.weight]
        : undefined)));
  return { rarityWeights, countWeights };
}

export function provingGroundsSettingsFromServer(doc) {
  const d = DEFAULT_PROVING_GROUNDS_SETTINGS;
  const s = isObject(doc?.proving_grounds) ? doc.proving_grounds : {};
  return {
    medalSeconds: mapOr(s.medal_seconds, d.medalSeconds, nonNegativeOr),
    maxWrongForBronze: countOr(s.max_wrong_for_bronze, d.maxWrongForBronze),
  };
}

export function trialSettingsFromServer(doc) {
  const d = DEFAULT_TRIAL_SETTINGS;
  const s = isObject(doc?.trial) ? doc.trial : {};
  let rangeMin = positiveIntOr(s.range_min, d.rangeMin);
  let rangeMax = positiveIntOr(s.range_max, d.rangeMax);
  if (rangeMin > rangeMax) [rangeMin, rangeMax] = [d.rangeMin, d.rangeMax];
  return {
    baselinePerOp: countOr(s.baseline_per_op, d.baselinePerOp),
    probeUncertain: countOr(s.probe_uncertain, d.probeUncertain),
    probeConfirm: countOr(s.probe_confirm, d.probeConfirm),
    probeStrongMinScore: nonNegativeOr(s.probe_strong_min_score, d.probeStrongMinScore),
    probeWeakBelowScore: nonNegativeOr(s.probe_weak_below_score, d.probeWeakBelowScore),
    maxTotalProblems: positiveIntOr(s.max_total_problems, d.maxTotalProblems),
    rangeMin,
    rangeMax,
    uniqueRetries: positiveIntOr(s.unique_retries, d.uniqueRetries),
    firstTryPoints: nonNegativeOr(s.first_try_points, d.firstTryPoints),
    secondTryPoints: nonNegativeOr(s.second_try_points, d.secondTryPoints),
    maxAttempts: positiveIntOr(s.max_attempts, d.maxAttempts),
    // JSON has no Infinity: the served open-ended last band has max_ms null.
    speedBands: listOr(s.speed_bands, d.speedBands, (b) => {
      if (!isObject(b) || !Number.isFinite(b.mult)) return undefined;
      if (b.max_ms === null) return { maxMs: Infinity, mult: b.mult };
      return Number.isFinite(b.max_ms) ? { maxMs: b.max_ms, mult: b.mult } : undefined;
    }),
    bandMinScores: mapOr(s.band_min_scores, d.bandMinScores, nonNegativeOr),
    opStartNode: mapOr(s.op_start_node, d.opStartNode, positiveIntOr),
    allMasteredNode: positiveIntOr(s.all_mastered_node, d.allMasteredNode),
    growlMs: nonNegativeOr(s.growl_ms, d.growlMs),
    growlJitterFraction: nonNegativeOr(s.growl_jitter_fraction, d.growlJitterFraction),
    growlMinMs: nonNegativeOr(s.growl_min_ms, d.growlMinMs),
  };
}

export function munchersSettingsFromServer(doc) {
  const d = DEFAULT_MUNCHERS_SETTINGS;
  const s = isObject(doc?.munchers) ? doc.munchers : {};
  const bases = (list, fallback) =>
    listOr(list, fallback, (v) => (Number.isInteger(v) && v >= 1 ? v : undefined));
  return {
    startingLives: positiveIntOr(s.starting_lives, d.startingLives),
    easyMaxBase: nonNegativeOr(s.easy_max_base, d.easyMaxBase),
    easyPoints: nonNegativeOr(s.easy_points, d.easyPoints),
    hardPoints: nonNegativeOr(s.hard_points, d.hardPoints),
    enemyMoveIntervalMs: positiveIntOr(s.enemy_move_interval_ms, d.enemyMoveIntervalMs),
    enemyTelegraphMs: countOr(s.enemy_telegraph_ms, d.enemyTelegraphMs),
    spawnIntervalMs: positiveIntOr(s.spawn_interval_ms, d.spawnIntervalMs),
    caughtBeatMs: countOr(s.caught_beat_ms, d.caughtBeatMs),
    chaseChance: fractionOr(s.chase_chance, d.chaseChance),
    progressionEasy: bases(s.progression_easy, d.progressionEasy),
    progressionHard: bases(s.progression_hard, d.progressionHard),
    enemySpeedupPerLevelMs: countOr(s.enemy_speedup_per_level_ms, d.enemySpeedupPerLevelMs),
    minEnemyIntervalMs: positiveIntOr(s.min_enemy_interval_ms, d.minEnemyIntervalMs),
    levelsPerExtraEnemy: positiveIntOr(s.levels_per_extra_enemy, d.levelsPerExtraEnemy),
    maxEnemies: positiveIntOr(s.max_enemies, d.maxEnemies),
  };
}

export function eggHatcherySettingsFromServer(doc) {
  const d = DEFAULT_EGG_HATCHERY_SETTINGS;
  const s = isObject(doc?.egg_hatchery) ? doc.egg_hatchery : {};
  return {
    tierSeconds: mapOr(s.tier_seconds, d.tierSeconds, nonNegativeOr),
    hintDelayMinMs: nonNegativeOr(s.hint_delay_min_ms, d.hintDelayMinMs),
    hintDelaySpreadMs: nonNegativeOr(s.hint_delay_spread_ms, d.hintDelaySpreadMs),
  };
}

export function steppingStonesSettingsFromServer(doc) {
  const d = DEFAULT_STEPPING_STONES_SETTINGS;
  const s = isObject(doc?.stepping_stones) ? doc.stepping_stones : {};
  return {
    numStones: positiveIntOr(s.num_stones, d.numStones),
    // At least the right answer and one distractor.
    choicesPerHop: intAtLeastOr(2)(s.choices_per_hop, d.choicesPerHop),
  };
}

export function memorizeSettingsFromServer(doc) {
  const d = DEFAULT_MEMORIZE_SETTINGS;
  const s = isObject(doc?.memorize) ? doc.memorize : {};
  const easyHideEvery = positiveIntOr(s.easy_hide_every, d.easyHideEvery);
  const offset = countOr(s.easy_hide_offset, d.easyHideOffset);
  // An offset the modulo can never produce would hide nothing.
  return { easyHideEvery, easyHideOffset: offset < easyHideEvery ? offset : d.easyHideOffset % easyHideEvery };
}
