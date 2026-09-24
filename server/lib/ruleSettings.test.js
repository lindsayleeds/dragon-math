// The rule-settings document builder, and the one property that keeps an
// offline web battle identical to an online one: the web fallbacks in
// src/data/battleSettings.js equal the values the server serves.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { DEFAULT_BATTLE_SETTINGS } from '../../src/data/battleSettings.js';

const require = createRequire(import.meta.url);
const {
  BATTLE_SETTINGS,
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

describe('buildRuleSettings', () => {
  it('returns a versioned document with the nodes and the battle section', () => {
    const doc = buildRuleSettings([NODE]);
    expect(doc.schema_version).toBe(RULE_SETTINGS_SCHEMA_VERSION);
    expect(doc.schema_version).toBe(1);
    expect(doc.version).toMatch(/^[0-9a-f]{16}$/);
    expect(doc.nodes).toEqual([NODE]);
    expect(doc.battle).toEqual(BATTLE_SETTINGS);
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
