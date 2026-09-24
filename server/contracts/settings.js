// Contract for the public game-settings routes: GET /api/rule-settings (the
// versioned document every game's rules read, server/lib/ruleSettings.js) and
// GET /api/node-config (the same per-node rows on their own). Both are public:
// nothing in them is user-specific, and a guest or an offline-first client needs
// them before anyone signs in.
const { z } = require('zod');
const { defineRoute } = require('./route');

const NodeConfig = z
  .object({
    node_id: z.number().int(),
    grid_size: z.number().int().meta({ description: 'Battle grid is grid_size × grid_size cells (2–10).' }),
    ops: z.array(z.string()).meta({ description: 'Operations this node draws problems from: add, sub, mul, div.' }),
    range_min: z.number().int(),
    range_max: z.number().int(),
    ai_seconds: z.number().meta({ description: "The opponent's base seconds per solve on this node." }),
    shape_id: z.string().nullable().meta({ description: 'Grid shape id, or null for a plain square grid.' }),
  })
  .meta({ id: 'NodeConfig' });

const NodeConfigResponse = z.object({ configs: z.array(NodeConfig) }).meta({ id: 'NodeConfigResponse' });

const OpponentSettings = z
  .object({
    jitter_fraction: z.number().meta({ description: 'Solve delay is ai_seconds × 1000 jittered by ±(jitter_fraction / 2).' }),
    min_delay_ms: z.number().int().meta({ description: 'The opponent never solves faster than this.' }),
  })
  .meta({ id: 'OpponentSettings' });

const BattleTimings = z
  .object({
    grid_blank_ms: z.number().int().meta({ description: 'Grid blank time after the child solves a problem.' }),
    grid_blank_ai_ms: z.number().int().meta({ description: 'Grid blank time after the opponent solves one.' }),
    grid_lock_ms: z.number().int().meta({ description: 'How long a wrong tap locks the grid.' }),
    wrong_flash_ms: z.number().int().meta({ description: 'How long the tapped wrong cell flashes.' }),
  })
  .meta({ id: 'BattleTimings' });

const BattleSettings = z
  .object({ opponent: OpponentSettings, timings: BattleTimings })
  .meta({ id: 'BattleSettings' });

const int = z.number().int();

const RarityWeights = z
  .object({
    common: z.number(),
    uncommon: z.number(),
    rare: z.number(),
    very_rare: z.number(),
    legendary: z.number(),
    mythic: z.number(),
  })
  .meta({
    id: 'RarityWeights',
    description: 'Relative draw weight per rarity. Only rarities with dragons in the catalog are drawn; a rarity not listed weighs 1.',
  });

const PrizeCountWeight = z
  .object({ count: int, weight: z.number() })
  .meta({ id: 'PrizeCountWeight' });

const PrizeCountWeights = z
  .object({
    low: z.array(PrizeCountWeight).meta({ description: 'After a loss.' }),
    normal: z.array(PrizeCountWeight).meta({ description: 'The default, and any unknown tier.' }),
    high: z.array(PrizeCountWeight).meta({ description: 'After a win.' }),
  })
  .meta({ id: 'PrizeCountWeights', description: 'How many dragons a prize holds, per performance tier, as weighted counts walked in order.' });

const PrizeSettings = z
  .object({ rarity_weights: RarityWeights, count_weights: PrizeCountWeights })
  .meta({ id: 'PrizeSettings', description: 'Post-game dragon prize odds (src/data/dragonPrize.js).' });

const MedalSeconds = z
  .object({ gold: z.number(), silver: z.number(), bronze: z.number() })
  .meta({ id: 'MedalSeconds', description: 'Inclusive finish-time ceilings in seconds.' });

const ProvingGroundsSettings = z
  .object({
    medal_seconds: MedalSeconds,
    max_wrong_for_bronze: int.meta({ description: 'Slips bronze allows; gold and silver need a perfect run.' }),
  })
  .meta({ id: 'ProvingGroundsSettings', description: 'Proving Grounds medal thresholds (src/rules/provingGrounds.js).' });

const TrialSpeedBand = z
  .object({
    max_ms: int.nullable().meta({ description: 'Upper bound (inclusive) on ms from display to the correct tap; null = no limit.' }),
    mult: z.number().meta({ description: 'Multiplier on the attempt points.' }),
  })
  .meta({ id: 'TrialSpeedBand' });

const TrialBandMinScores = z
  .object({ fluent: z.number(), capable: z.number(), developing: z.number(), emerging: z.number() })
  .meta({ id: 'TrialBandMinScores', description: 'Lowest normalized score (0–1000) per confidence band; below emerging is not_ready.' });

const TrialOpStartNodes = z
  .object({ add: int, sub: int, mul: int })
  .meta({ id: 'TrialOpStartNodes', description: 'Placement node for a kid whose first unmastered op is this one.' });

const TrialSettings = z
  .object({
    baseline_per_op: int.meta({ description: 'Baseline problems per op (add, sub, mul, div).' }),
    probe_uncertain: int.meta({ description: 'Probe problems for an op whose baseline is uncertain.' }),
    probe_confirm: int.meta({ description: 'Probe problems for an op whose baseline is strong.' }),
    probe_strong_min_score: z.number().meta({ description: 'Baseline score at or above which an op is strong.' }),
    probe_weak_below_score: z.number().meta({ description: 'Baseline score below which an op is weak (no further probes).' }),
    max_total_problems: int,
    range_min: int.meta({ description: 'Operand range every trial problem draws from.' }),
    range_max: int,
    unique_retries: int.meta({ description: 'Tries for a problem not asked yet before accepting a repeat.' }),
    first_try_points: z.number(),
    second_try_points: z.number(),
    max_attempts: int.meta({ description: 'Wrong taps that resolve a problem at 0 points.' }),
    speed_bands: z.array(TrialSpeedBand).meta({ description: 'First band whose max_ms the answer time is within.' }),
    band_min_scores: TrialBandMinScores,
    op_start_node: TrialOpStartNodes,
    all_mastered_node: int.meta({ description: 'Placement node when add, sub and mul are all fluent.' }),
    growl_ms: z.number().meta({ description: 'Atmospheric growl every growl_ms ± (growl_jitter_fraction / 2).' }),
    growl_jitter_fraction: z.number(),
    growl_min_ms: z.number(),
  })
  .meta({ id: 'TrialSettings', description: "Dragon's Trial tunables (src/rules/dragonTrial.js, docs/TRIAL.md)." });

const MunchersSettings = z
  .object({
    starting_lives: int,
    easy_max_base: int.meta({ description: 'Bases up to this are worth easy_points a correct answer; above, hard_points.' }),
    easy_points: int,
    hard_points: int,
    enemy_move_interval_ms: int,
    enemy_telegraph_ms: int.meta({ description: 'How long a monster faces its next cell before stepping.' }),
    spawn_interval_ms: int,
    caught_beat_ms: int.meta({ description: 'The gobble beat before a caught muncher loses a life.' }),
    chase_chance: z.number().meta({ description: 'Share of moves (0–1) where a monster chases rather than wanders.' }),
    progression_easy: z.array(int).meta({ description: 'Campaign bases played first, shuffled.' }),
    progression_hard: z.array(int).meta({ description: 'Campaign bases played after the easy ones, shuffled.' }),
    enemy_speedup_per_level_ms: int,
    min_enemy_interval_ms: int,
    levels_per_extra_enemy: int,
    max_enemies: int,
  })
  .meta({ id: 'MunchersSettings', description: 'Dragon Munchers tunables (src/rules/munchers.js).' });

const EggTierSeconds = z
  .object({ legendary: z.number(), gold: z.number(), silver: z.number() })
  .meta({ id: 'EggTierSeconds', description: 'Seconds UNDER which each tier is earned; slower than silver is bronze.' });

const EggHatcherySettings = z
  .object({
    tier_seconds: EggTierSeconds,
    hint_delay_min_ms: z.number().meta({ description: 'A hint is offered hint_delay_min_ms + random × hint_delay_spread_ms in.' }),
    hint_delay_spread_ms: z.number(),
  })
  .meta({ id: 'EggHatcherySettings', description: 'Dragon Egg Hatchery tunables (src/rules/eggHatchery.js).' });

const SteppingStonesSettings = z
  .object({
    num_stones: int.meta({ description: 'Rocks in a crossing.' }),
    choices_per_hop: int.meta({ description: 'Lily pads offered per hop, the right one included.' }),
  })
  .meta({ id: 'SteppingStonesSettings', description: 'Stepping Stones tunables (src/rules/steppingStones.js).' });

const MemorizeSettings = z
  .object({
    easy_hide_every: int.meta({ description: 'Easy hides word i of sentence s when (i + s) % easy_hide_every === easy_hide_offset.' }),
    easy_hide_offset: int,
  })
  .meta({ id: 'MemorizeSettings', description: 'Dragon Memorize tunables (src/rules/memorize.js).' });

const RuleSettings = z
  .object({
    schema_version: z.number().int().meta({
      description: 'Shape of this document. Bumped only for a breaking change; new sections and fields are not breaking.',
    }),
    nodes: z.array(NodeConfig).meta({ description: 'Per-node config, in node_id order.' }),
    battle: BattleSettings,
    prize: PrizeSettings,
    proving_grounds: ProvingGroundsSettings,
    trial: TrialSettings,
    munchers: MunchersSettings,
    egg_hatchery: EggHatcherySettings,
    stepping_stones: SteppingStonesSettings,
    memorize: MemorizeSettings,
    version: z.string().meta({ description: 'Hash of the content. Changes whenever any value does; compare to a cached copy.' }),
  })
  .meta({ id: 'RuleSettings' });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/rule-settings',
    operationId: 'getRuleSettings',
    summary: 'Every tunable the game rules read: per-node config plus each game\'s game-wide settings.',
    tags: ['settings'],
    responses: { 200: { description: 'The rule-settings document.', schema: RuleSettings } },
  }),
  defineRoute({
    method: 'get',
    path: '/api/node-config',
    operationId: 'getNodeConfig',
    summary: 'Per-node battle config, in node_id order.',
    tags: ['settings'],
    responses: { 200: { description: 'Every node config row.', schema: NodeConfigResponse } },
  }),
];

module.exports = { routes };
