// Static catalog of all companion dragons.
// - Pip is the starter, auto-granted server-side on first /api/companions fetch.
// - Boss dragons are befriended after defeating their matching boss node.
//
// For v1, every companion's Bond Power is the same 2x2 hint ("hint2x2"); only
// the name and highlight color differ. Differentiated abilities can be added
// later by changing `bondPower.kind` and adding new handlers in useBattle.js.

export const COMPANIONS = {
  pip: {
    id: 'pip',
    name: 'Pip',
    icon: '🐲',
    tagline: 'Your tiny pocket dragon.',
    bondPower: {
      name: "Pip's Peek",
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#9ed8ff',  // soft sky blue
    },
  },
  forest_dragon: {
    id: 'forest_dragon',
    name: 'Forest Dragon',
    icon: '🐲',
    tagline: 'Guardian of the Mushroom Forest.',
    capturedAtNodeId: 8,
    bondPower: {
      name: 'Forest Sight',
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#a5e6b8',  // soft moss green
    },
  },
  sunfire_dragon: {
    id: 'sunfire_dragon',
    name: 'Sunfire Dragon',
    icon: '🐲',
    tagline: 'Guardian of the Honeyfield Plains.',
    capturedAtNodeId: 16,
    bondPower: {
      name: 'Sunfire Gaze',
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#ffd87a',  // warm honey gold
    },
  },
  crystal_dragon: {
    id: 'crystal_dragon',
    name: 'Crystal Dragon',
    icon: '🐉',
    tagline: 'Guardian of the Crystal Caves.',
    capturedAtNodeId: 25,
    bondPower: {
      name: 'Crystal Vision',
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#d4b8ff',  // amethyst violet
    },
  },
  sakura_dragon: {
    id: 'sakura_dragon',
    name: 'Sakura Dragon',
    icon: '🐲',
    tagline: 'Guardian of Sakura Vale.',
    capturedAtNodeId: 33,
    bondPower: {
      name: 'Petal Glance',
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#ffc4dd',  // cherry blossom pink
    },
  },
  storm_dragon: {
    id: 'storm_dragon',
    name: 'Storm Dragon',
    icon: '🐉',
    tagline: 'Guardian of Cloudspire Heights.',
    capturedAtNodeId: 41,
    bondPower: {
      name: 'Stormsense',
      kind: 'hint2x2',
      cooldownMs: 20_000,
      durationMs: 2_000,
      highlightColor: '#a8d8f0',  // breezy sky teal
    },
  },
};

// Boss node → companion id. Mirrors BOSS_NODE_TO_COMPANION in
// server/routes/companions.js.
export const NODE_TO_COMPANION = {
  8:  'forest_dragon',
  16: 'sunfire_dragon',
  25: 'crystal_dragon',
  33: 'sakura_dragon',
  41: 'storm_dragon',
};

export function getCompanion(id) {
  return COMPANIONS[id] || COMPANIONS.pip;
}
