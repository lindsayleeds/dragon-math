// The rule settings a golden fixture was generated with, for its `settings`
// field: the rule-settings document's schema_version plus the named sections,
// exactly as GET /api/rule-settings serves them (server/lib/ruleSettings.js,
// snake_case). A Swift port decodes this with the same types it decodes the
// live document with, converts it, and runs the fixture's cases on the result.
//
// The fixtures run the rules on the WEB fallbacks (src/data/ruleSettings.js),
// so this also refuses to build a fixture if converting the served section
// would give anything else — the fixture would then claim settings it was not
// generated with. (server/lib/ruleSettings.test.js checks the same equality
// field by field; this is the belt to its braces.)
//
// Node only (createRequire loads the CommonJS server module), like
// phonicsGolden.js: only the golden script and its drift test import this.

import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(import.meta.url);
const { GAME_SETTINGS, RULE_SETTINGS_SCHEMA_VERSION } = require('../../server/lib/ruleSettings.js');

// sections: { <served section name>: [fromServer converter, web defaults] }
export function goldenSettings(sections) {
  const out = { schema_version: RULE_SETTINGS_SCHEMA_VERSION };
  for (const [name, [fromServer, defaults]] of Object.entries(sections)) {
    const served = GAME_SETTINGS[name];
    if (!served) throw new Error(`goldenSettings: no served section "${name}"`);
    if (!isDeepStrictEqual(fromServer({ [name]: served }), defaults)) {
      throw new Error(`goldenSettings: the served "${name}" section does not convert to the web fallbacks`);
    }
    out[name] = served;
  }
  return out;
}

// A served section with some fields replaced, for a fixture case that runs the
// rules on non-default settings. Returns the served (snake_case) section, to
// record, and the converted one, to run the rules on.
export function tunedSettings(name, fromServer, overrides) {
  const served = { ...GAME_SETTINGS[name], ...overrides };
  return { served, settings: fromServer({ [name]: served }) };
}
