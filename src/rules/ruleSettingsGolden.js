// The `rule-settings` golden fixture (golden/rule-settings.json): a whole
// GET /api/rule-settings document as the server builds it
// (server/lib/ruleSettings.js), over two sample node rows. The iOS Sync tests
// decode it with the generated `Components.Schemas.RuleSettings` — the same
// type the app caches the live document as — so a served section the Swift
// client can't decode fails there, and the drift test keeps it current when a
// section is added. Registered in buildGoldenFiles() in ./golden.js.
//
// Node only (createRequire loads the CommonJS server module), like
// goldenSettings.js: only the golden script and its drift test import this.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRuleSettings } = require('../../server/lib/ruleSettings.js');

const SAMPLE_NODES = [
  { node_id: 1, grid_size: 3, ops: ['add'], range_min: 1, range_max: 3, ai_seconds: 10, shape_id: null },
  { node_id: 2, grid_size: 4, ops: ['add', 'sub'], range_min: 1, range_max: 20, ai_seconds: 5.5, shape_id: 'heart' },
];

export function ruleSettingsFixture() {
  return {
    fixture: 'rule-settings',
    version: 1,
    document: buildRuleSettings(SAMPLE_NODES),
  };
}
