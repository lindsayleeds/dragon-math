// The rule-settings document builder, and the one property that keeps an
// offline web game identical to an online one: the web fallbacks in
// src/data/battleSettings.js and src/data/ruleSettings.js equal the values the
// server serves, field by field.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { DEFAULT_BATTLE_SETTINGS } from '../../src/data/battleSettings.js';
import * as web from '../../src/data/ruleSettings.js';

const require = createRequire(import.meta.url);
const {
  BATTLE_SETTINGS,
  GAME_SETTINGS,
  RULE_SETTINGS_SCHEMA_VERSION,
  buildRuleSettings,
} = require('./ruleSettings');

const NODE = { node_id: 1, grid_size: 5, ops: ['add'], range_min: 1, range_max: 3, ai_seconds: 10, shape_id: null };

describe('BATTLE_SETTINGS', () => {
  it('serves exactly the web battle fallbacks', () => {
    expect(BATTLE_SETTINGS.opponent.jitter_fraction).toBe(DEFAULT_BATTLE_SETTINGS.aiJitterFraction);
    expect(BATTLE_SETTINGS.opponent.min_delay_ms).toBe(DEFAULT_BATTLE_SETTINGS.aiMinDelayMs);
    expect(BATTLE_SETTINGS.timings.grid_blank_ms).toBe(DEFAULT_BATTLE_SETTINGS.gridBlankMs);
    expect(BATTLE_SETTINGS.timings.grid_blank_ai_ms).toBe(DEFAULT_BATTLE_SETTINGS.gridBlankAiMs);
    expect(BATTLE_SETTINGS.timings.grid_lock_ms).toBe(DEFAULT_BATTLE_SETTINGS.gridLockMs);
    expect(BATTLE_SETTINGS.timings.wrong_flash_ms).toBe(DEFAULT_BATTLE_SETTINGS.wrongFlashMs);
  });

  it('has a web fallback for every served battle value', () => {
    const served = [
      ...Object.keys(BATTLE_SETTINGS.opponent),
      ...Object.keys(BATTLE_SETTINGS.timings),
    ];
    expect(served).toHaveLength(Object.keys(DEFAULT_BATTLE_SETTINGS).length);
  });
});

// Every served field and the web fallback it must equal: [served path, web
// path] within the section. A list compares element by element; `null` served
// (an open-ended speed band) is Infinity on the web.
const FIELDS = {
  prize: {
    fallback: web.DEFAULT_PRIZE_SETTINGS,
    fromServer: web.prizeSettingsFromServer,
    fields: [
      ...['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'mythic']
        .map(r => [`rarity_weights.${r}`, `rarityWeights.${r}`]),
      ...['low', 'normal', 'high'].flatMap(tier => [0, 1, 2].flatMap(i => [
        [`count_weights.${tier}.${i}.count`, `countWeights.${tier}.${i}.0`],
        [`count_weights.${tier}.${i}.weight`, `countWeights.${tier}.${i}.1`],
      ])),
    ],
  },
  proving_grounds: {
    fallback: web.DEFAULT_PROVING_GROUNDS_SETTINGS,
    fromServer: web.provingGroundsSettingsFromServer,
    fields: [
      ['medal_seconds.gold', 'medalSeconds.gold'],
      ['medal_seconds.silver', 'medalSeconds.silver'],
      ['medal_seconds.bronze', 'medalSeconds.bronze'],
      ['max_wrong_for_bronze', 'maxWrongForBronze'],
    ],
  },
  trial: {
    fallback: web.DEFAULT_TRIAL_SETTINGS,
    fromServer: web.trialSettingsFromServer,
    fields: [
      ['baseline_per_op', 'baselinePerOp'],
      ['probe_uncertain', 'probeUncertain'],
      ['probe_confirm', 'probeConfirm'],
      ['probe_strong_min_score', 'probeStrongMinScore'],
      ['probe_weak_below_score', 'probeWeakBelowScore'],
      ['max_total_problems', 'maxTotalProblems'],
      ['range_min', 'rangeMin'],
      ['range_max', 'rangeMax'],
      ['unique_retries', 'uniqueRetries'],
      ['first_try_points', 'firstTryPoints'],
      ['second_try_points', 'secondTryPoints'],
      ['max_attempts', 'maxAttempts'],
      ...[0, 1, 2, 3].flatMap(i => [
        [`speed_bands.${i}.max_ms`, `speedBands.${i}.maxMs`],
        [`speed_bands.${i}.mult`, `speedBands.${i}.mult`],
      ]),
      ...['fluent', 'capable', 'developing', 'emerging']
        .map(b => [`band_min_scores.${b}`, `bandMinScores.${b}`]),
      ['op_start_node.add', 'opStartNode.add'],
      ['op_start_node.sub', 'opStartNode.sub'],
      ['op_start_node.mul', 'opStartNode.mul'],
      ['all_mastered_node', 'allMasteredNode'],
      ['growl_ms', 'growlMs'],
      ['growl_jitter_fraction', 'growlJitterFraction'],
      ['growl_min_ms', 'growlMinMs'],
    ],
  },
  munchers: {
    fallback: web.DEFAULT_MUNCHERS_SETTINGS,
    fromServer: web.munchersSettingsFromServer,
    fields: [
      ['starting_lives', 'startingLives'],
      ['easy_max_base', 'easyMaxBase'],
      ['easy_points', 'easyPoints'],
      ['hard_points', 'hardPoints'],
      ['enemy_move_interval_ms', 'enemyMoveIntervalMs'],
      ['enemy_telegraph_ms', 'enemyTelegraphMs'],
      ['spawn_interval_ms', 'spawnIntervalMs'],
      ['caught_beat_ms', 'caughtBeatMs'],
      ['chase_chance', 'chaseChance'],
      ...[0, 1, 2, 3].map(i => [`progression_easy.${i}`, `progressionEasy.${i}`]),
      ...[0, 1, 2, 3].map(i => [`progression_hard.${i}`, `progressionHard.${i}`]),
      ['enemy_speedup_per_level_ms', 'enemySpeedupPerLevelMs'],
      ['min_enemy_interval_ms', 'minEnemyIntervalMs'],
      ['levels_per_extra_enemy', 'levelsPerExtraEnemy'],
      ['max_enemies', 'maxEnemies'],
    ],
  },
  egg_hatchery: {
    fallback: web.DEFAULT_EGG_HATCHERY_SETTINGS,
    fromServer: web.eggHatcherySettingsFromServer,
    fields: [
      ['tier_seconds.legendary', 'tierSeconds.legendary'],
      ['tier_seconds.gold', 'tierSeconds.gold'],
      ['tier_seconds.silver', 'tierSeconds.silver'],
      ['hint_delay_min_ms', 'hintDelayMinMs'],
      ['hint_delay_spread_ms', 'hintDelaySpreadMs'],
    ],
  },
  stepping_stones: {
    fallback: web.DEFAULT_STEPPING_STONES_SETTINGS,
    fromServer: web.steppingStonesSettingsFromServer,
    fields: [
      ['num_stones', 'numStones'],
      ['choices_per_hop', 'choicesPerHop'],
    ],
  },
  memorize: {
    fallback: web.DEFAULT_MEMORIZE_SETTINGS,
    fromServer: web.memorizeSettingsFromServer,
    fields: [
      ['easy_hide_every', 'easyHideEvery'],
      ['easy_hide_offset', 'easyHideOffset'],
    ],
  },
};

const at = (obj, path) => path.split('.').reduce((v, k) => v?.[k], obj);

// Every leaf path of a nested object/array, e.g. 'speed_bands.3.max_ms'.
function leaves(value, prefix = '') {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('game-wide sections', () => {
  it('serves exactly the sections the web has fallbacks for', () => {
    expect(Object.keys(GAME_SETTINGS)).toEqual(['battle', ...Object.keys(FIELDS)]);
  });

  describe.each(Object.entries(FIELDS))('%s', (section, { fallback, fromServer, fields }) => {
    const served = GAME_SETTINGS[section];

    it.each(fields)('serves %s equal to the web fallback %s', (servedPath, webPath) => {
      const value = at(served, servedPath);
      const expected = at(fallback, webPath);
      expect(value).not.toBeUndefined();
      expect(expected).not.toBeUndefined();
      if (value === null) expect(expected).toBe(Infinity);
      else expect(value).toBe(expected);
    });

    it('lists every served field and every web fallback', () => {
      expect(fields.map(([s]) => s).sort()).toEqual(leaves(served).sort());
      expect(fields.map(([, w]) => w).sort()).toEqual(leaves(fallback).sort());
    });

    it('converts the served section to exactly the web fallbacks', () => {
      expect(fromServer({ [section]: served })).toEqual(fallback);
    });

    it('falls back field by field for a missing or unusable section', () => {
      expect(fromServer(null)).toEqual(fallback);
      expect(fromServer({})).toEqual(fallback);
      expect(fromServer({ [section]: 'nonsense' })).toEqual(fallback);
      const garbage = Object.fromEntries(Object.keys(served).map(k => [k, -1.5]));
      expect(fromServer({ [section]: garbage })).toEqual(fallback);
    });
  });
});

describe('the web converters', () => {
  it('take a served value that differs, keeping the fallback beside it', () => {
    const trial = web.trialSettingsFromServer({
      trial: { baseline_per_op: 4, speed_bands: [{ max_ms: 100, mult: 1 }, { max_ms: null, mult: 0.1 }] },
    });
    expect(trial.baselinePerOp).toBe(4);
    expect(trial.speedBands).toEqual([{ maxMs: 100, mult: 1 }, { maxMs: Infinity, mult: 0.1 }]);
    expect(trial.probeUncertain).toBe(web.DEFAULT_TRIAL_SETTINGS.probeUncertain);

    const prize = web.prizeSettingsFromServer({
      prize: { rarity_weights: { mythic: 5, sparkly: 2 }, count_weights: { high: [{ count: 3, weight: 1 }] } },
    });
    expect(prize.rarityWeights).toEqual({ ...web.DEFAULT_PRIZE_SETTINGS.rarityWeights, mythic: 5, sparkly: 2 });
    expect(prize.countWeights.high).toEqual([[3, 1]]);
    expect(prize.countWeights.low).toEqual(web.DEFAULT_PRIZE_SETTINGS.countWeights.low);

    const munchers = web.munchersSettingsFromServer({ munchers: { progression_easy: [2, 'x'], chase_chance: 1.5 } });
    expect(munchers.progressionEasy).toEqual(web.DEFAULT_MUNCHERS_SETTINGS.progressionEasy);
    expect(munchers.chaseChance).toBe(web.DEFAULT_MUNCHERS_SETTINGS.chaseChance);
  });

  it('keep an inverted trial range from reaching the rules', () => {
    const trial = web.trialSettingsFromServer({ trial: { range_min: 9, range_max: 3 } });
    expect([trial.rangeMin, trial.rangeMax]).toEqual([2, 10]);
  });
});

describe('buildRuleSettings', () => {
  it('returns a versioned document with the nodes and every game-wide section', () => {
    const doc = buildRuleSettings([NODE]);
    expect(doc.schema_version).toBe(RULE_SETTINGS_SCHEMA_VERSION);
    expect(doc.schema_version).toBe(1);
    expect(doc.version).toMatch(/^[0-9a-f]{16}$/);
    expect(doc.nodes).toEqual([NODE]);
    expect(doc.battle).toEqual(BATTLE_SETTINGS);
    for (const [section, values] of Object.entries(GAME_SETTINGS)) expect(doc[section]).toEqual(values);
  });

  it('keeps the same version for the same content', () => {
    expect(buildRuleSettings([NODE]).version).toBe(buildRuleSettings([{ ...NODE }]).version);
  });

  it('changes the version when any node value changes', () => {
    const before = buildRuleSettings([NODE]).version;
    const after = buildRuleSettings([{ ...NODE, ai_seconds: 9.5 }]).version;
    expect(after).not.toBe(before);
  });
});
