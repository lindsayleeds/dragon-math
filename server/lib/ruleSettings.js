// The rule-settings document: every tunable number the game rules read, served
// by GET /api/rule-settings so the web app and the iOS app play by the same
// values without an app release (ADR 0005).
//
// Pure on purpose — no db, no express. The route loads the per-node rows and
// hands them here; everything else is a constant in this file.
//
// Two version fields, and they answer different questions:
//   schema_version — the SHAPE of the document. Bump it only for a breaking
//                    change (a field renamed, removed or retyped). Adding a new
//                    section or field is not breaking: clients ignore what they
//                    don't know and fall back for what is missing.
//   version        — the CONTENT. A hash of everything below, so a client that
//                    cached a copy can tell whether anything changed.
//
// Every section is a new top-level key beside `battle`. The web fallbacks must
// equal what is served here exactly — src/data/battleSettings.js for `battle`,
// src/data/ruleSettings.js for every other section — and
// server/lib/ruleSettings.test.js asserts it field by field. The golden
// fixtures (golden/*.json) record the section they were generated from under
// `settings`, so a Swift port can check it decodes the same values.
//
// Editing: the per-node rows come from the node_config table and are editable
// in /admin. The game-wide sections below are seeded constants — changing one
// is a code change (edit it here AND the matching web fallback, then
// `npm run golden:generate`), not an admin action. The document shape already
// lets a later admin editor override them without a client release.

const crypto = require('crypto');

const RULE_SETTINGS_SCHEMA_VERSION = 1;

// Battle tunables that are the same on every node. Per-node opponent pace
// (`ai_seconds`) lives on each `nodes[]` row, as it does in node_config.
const BATTLE_SETTINGS = Object.freeze({
  opponent: Object.freeze({
    // The opponent's solve delay is ai_seconds * 1000, jittered by
    // ±(jitter_fraction / 2) — 0.35 is ±17.5% — and never shorter than
    // min_delay_ms.
    jitter_fraction: 0.35,
    min_delay_ms: 1500,
  }),
  timings: Object.freeze({
    // Grid goes blank this long between problems after the child solves one.
    grid_blank_ms: 500,
    // ...and this long after the opponent solves one (its "gobble" animation).
    grid_blank_ai_ms: 2000,
    // A wrong tap locks the whole grid this long.
    grid_lock_ms: 4000,
    // The tapped wrong cell flashes this long.
    wrong_flash_ms: 350,
  }),
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// Dragon prize draws (src/data/dragonPrize.js).
const PRIZE_SETTINGS = deepFreeze({
  // Relative draw weight per rarity. Only rarities present in the catalog are
  // drawn; a rarity missing here weighs 1.
  rarity_weights: {
    common: 100,
    uncommon: 45,
    rare: 18,
    very_rare: 6,
    legendary: 2,
    mythic: 0.6,
  },
  // How many dragons a prize holds, per performance tier (losses → low,
  // wins → high; unknown tiers use normal), as weighted counts.
  count_weights: {
    low: [{ count: 1, weight: 70 }, { count: 2, weight: 25 }, { count: 3, weight: 5 }],
    normal: [{ count: 1, weight: 45 }, { count: 2, weight: 40 }, { count: 3, weight: 15 }],
    high: [{ count: 1, weight: 20 }, { count: 2, weight: 45 }, { count: 3, weight: 35 }],
  },
});

// Proving Grounds medals (src/rules/provingGrounds.js).
const PROVING_GROUNDS_SETTINGS = deepFreeze({
  // Inclusive finish-time ceilings in seconds. Gold and silver need a perfect
  // run; bronze allows max_wrong_for_bronze slips.
  medal_seconds: { gold: 45, silver: 60, bronze: 90 },
  max_wrong_for_bronze: 1,
});

// The Dragon's Trial (src/rules/dragonTrial.js, docs/TRIAL.md).
const TRIAL_SETTINGS = deepFreeze({
  baseline_per_op: 3,
  probe_uncertain: 5,
  probe_confirm: 2,
  // Baseline score (0–1000) at or above which an op is "strong", and below
  // which it is "weak"; between is "uncertain".
  probe_strong_min_score: 800,
  probe_weak_below_score: 400,
  max_total_problems: 50,
  range_min: 2,
  range_max: 10,
  unique_retries: 25,
  first_try_points: 200,
  second_try_points: 150,
  max_attempts: 2,
  // First band whose max_ms the answer time is within; null = no limit.
  speed_bands: [
    { max_ms: 4000, mult: 1.0 },
    { max_ms: 8000, mult: 0.9 },
    { max_ms: 12000, mult: 0.75 },
    { max_ms: null, mult: 0.6 },
  ],
  // Lowest normalized score for each band; below emerging is not_ready.
  band_min_scores: { fluent: 850, capable: 700, developing: 500, emerging: 300 },
  op_start_node: { add: 1, sub: 17, mul: 26 },
  all_mastered_node: 34,
  growl_ms: 12000,
  growl_jitter_fraction: 0.3,
  growl_min_ms: 4000,
});

// Dragon Munchers (src/rules/munchers.js). The board size and the ×12 table
// stay code: the layout is built around them.
const MUNCHERS_SETTINGS = deepFreeze({
  starting_lives: 3,
  easy_max_base: 5,
  easy_points: 5,
  hard_points: 10,
  enemy_move_interval_ms: 3000,
  enemy_telegraph_ms: 750,
  spawn_interval_ms: 4000,
  caught_beat_ms: 1000,
  chase_chance: 0.6,
  progression_easy: [2, 3, 4, 5],
  progression_hard: [6, 7, 8, 9],
  enemy_speedup_per_level_ms: 220,
  min_enemy_interval_ms: 1100,
  levels_per_extra_enemy: 3,
  max_enemies: 3,
});

// Dragon Egg Hatchery (src/rules/eggHatchery.js).
const EGG_HATCHERY_SETTINGS = deepFreeze({
  // Seconds UNDER which each tier is earned; slower than silver is bronze.
  tier_seconds: { legendary: 15, gold: 25, silver: 40 },
  // A hint is offered hint_delay_min_ms + rng() * hint_delay_spread_ms in.
  hint_delay_min_ms: 5000,
  hint_delay_spread_ms: 2000,
});

// Stepping Stones (src/rules/steppingStones.js).
const STEPPING_STONES_SETTINGS = deepFreeze({
  num_stones: 10,
  choices_per_hop: 4,
});

// Dragon Memorize (src/rules/memorize.js): Easy hides word i of sentence s
// when (i + s) % easy_hide_every === easy_hide_offset.
const MEMORIZE_SETTINGS = deepFreeze({
  easy_hide_every: 4,
  easy_hide_offset: 1,
});

// The game-wide sections, in document order.
const GAME_SETTINGS = Object.freeze({
  battle: BATTLE_SETTINGS,
  prize: PRIZE_SETTINGS,
  proving_grounds: PROVING_GROUNDS_SETTINGS,
  trial: TRIAL_SETTINGS,
  munchers: MUNCHERS_SETTINGS,
  egg_hatchery: EGG_HATCHERY_SETTINGS,
  stepping_stones: STEPPING_STONES_SETTINGS,
  memorize: MEMORIZE_SETTINGS,
});

function contentVersion(content) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 16);
}

// nodeRows: the parsed node_config rows, in node_id order (the same shape
// GET /api/node-config returns under `configs`).
function buildRuleSettings(nodeRows) {
  const content = {
    schema_version: RULE_SETTINGS_SCHEMA_VERSION,
    nodes: nodeRows,
    ...GAME_SETTINGS,
  };
  return { ...content, version: contentVersion(content) };
}

module.exports = {
  RULE_SETTINGS_SCHEMA_VERSION,
  BATTLE_SETTINGS,
  PRIZE_SETTINGS,
  PROVING_GROUNDS_SETTINGS,
  TRIAL_SETTINGS,
  MUNCHERS_SETTINGS,
  EGG_HATCHERY_SETTINGS,
  STEPPING_STONES_SETTINGS,
  MEMORIZE_SETTINGS,
  GAME_SETTINGS,
  buildRuleSettings,
};
