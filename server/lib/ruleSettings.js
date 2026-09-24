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
// The web fallbacks in src/data/battleSettings.js must equal BATTLE_SETTINGS
// exactly; server/lib/ruleSettings.test.js asserts it. Later sections (prize
// odds, medal thresholds, trial and Munchers tunables) are added as new
// top-level keys beside `battle`.

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
    battle: BATTLE_SETTINGS,
  };
  return { ...content, version: contentVersion(content) };
}

module.exports = {
  RULE_SETTINGS_SCHEMA_VERSION,
  BATTLE_SETTINGS,
  buildRuleSettings,
};
