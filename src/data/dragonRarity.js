// Collectible-dragon rarity definitions, shared by the kid's Dragon Collection
// page and the admin "Dragons" classification tab.
//
// The collectible art lives in public/dragon_pngs/1.png … <DRAGON_PNG_COUNT>.png.
// Every dragon starts 'common'; a keeper reclassifies them in the admin tools.
// Keep RARITY_KEYS in sync with the CHECK constraint on dragon_catalog.rarity
// (server/db/schema.js) and the VALID_RARITIES set in server/routes/admin.js.

export const DRAGON_PNG_COUNT = 253;

// Ordered weakest → strongest. `key` is what the DB stores; `label` is shown to
// kids/keepers; `color` tints the rarity's badge, frame, and section header.
export const RARITIES = [
  { key: 'common',    label: 'Common',    color: '#8d9aa5', glow: 'rgba(141,154,165,0.45)' },
  { key: 'uncommon',  label: 'Uncommon',  color: '#4caf72', glow: 'rgba(76,175,114,0.5)' },
  { key: 'rare',      label: 'Rare',      color: '#3d8bdf', glow: 'rgba(61,139,223,0.55)' },
  { key: 'very_rare', label: 'Very Rare', color: '#9b59d0', glow: 'rgba(155,89,208,0.6)' },
  { key: 'legendary', label: 'Legendary', color: '#e8a317', glow: 'rgba(232,163,23,0.65)' },
  { key: 'mythic',    label: 'Mythic',    color: '#e0457b', glow: 'rgba(224,69,123,0.7)' },
];

export const RARITY_KEYS = RARITIES.map(r => r.key);

export const RARITY_BY_KEY = Object.fromEntries(RARITIES.map(r => [r.key, r]));

export const DEFAULT_RARITY = 'common';

export function rarityMeta(key) {
  return RARITY_BY_KEY[key] || RARITY_BY_KEY[DEFAULT_RARITY];
}

// Path to a dragon's art from its catalog id.
export function dragonImage(dragonId) {
  return `/dragon_pngs/${dragonId}.png`;
}
