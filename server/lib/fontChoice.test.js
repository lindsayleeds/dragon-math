// The server's font list against the web themes it mirrors
// (src/data/fontThemes.js): PUT /api/auth/profile and the `font_chosen` sync
// kind validate `font` with it, and the iOS picker is generated from the same
// themes.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { FONT_THEMES, DEFAULT_FONT_THEME } from '../../src/data/fontThemes.js';

const require = createRequire(import.meta.url);
const { ALLOWED_FONTS } = require('../contracts/auth');
const { SYNC_PAYLOADS } = require('../contracts/sync');

describe('font ids', () => {
  it('are the web themes, in picker order', () => {
    expect(ALLOWED_FONTS).toEqual(FONT_THEMES.map(t => t.id));
    expect(ALLOWED_FONTS).toContain(DEFAULT_FONT_THEME);
  });

  it('are what font_chosen accepts', () => {
    for (const font of ALLOWED_FONTS) expect(SYNC_PAYLOADS.font_chosen.safeParse({ font }).success).toBe(true);
    expect(SYNC_PAYLOADS.font_chosen.safeParse({ font: 'papyrus' }).success).toBe(false);
  });
});
