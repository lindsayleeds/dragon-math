// The server's companion ids against the web catalog they mirror
// (src/data/companions.js): the sync contract validates companion_id with them,
// and the web routes use them to check captures and choices.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { COMPANIONS, NODE_TO_COMPANION } from '../../src/data/companions.js';

const require = createRequire(import.meta.url);
const { BOSS_NODE_TO_COMPANION, BOSS_NODE_IDS, COMPANION_IDS, VALID_COMPANION_IDS } = require('./companions');

describe('companion ids', () => {
  it('are the web catalog, in collection order', () => {
    expect(COMPANION_IDS).toEqual(Object.keys(COMPANIONS));
    expect([...VALID_COMPANION_IDS]).toEqual(COMPANION_IDS);
  });

  it('map boss nodes as the web does', () => {
    expect(BOSS_NODE_TO_COMPANION).toEqual(NODE_TO_COMPANION);
    expect(BOSS_NODE_IDS).toEqual([8, 16, 25, 33, 41]);
    for (const c of Object.values(COMPANIONS)) {
      if (c.capturedAtNodeId) expect(BOSS_NODE_TO_COMPANION[c.capturedAtNodeId]).toBe(c.id);
    }
  });
});
