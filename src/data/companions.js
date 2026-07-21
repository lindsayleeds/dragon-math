// Static catalog of all companion dragons.
// - Pip is the starter, auto-granted server-side on first /api/companions fetch.
// - Boss dragons are befriended after defeating their matching boss node.
//
// Bond Power kinds (handlers live in useBattle.js). Each of the six is a
// distinct mechanic — no two companions share a power:
//   hint2x2         — highlights a 2x2 region containing the answer (fuzzy hint)
//   revealAnswer    — pinpoints the single answer cell with a glow (exact hint)
//   mushroomGrove   — covers ~half the wrong cells with mushrooms until next problem
//   lightningStrike — zaps 3–4 wrong cells off the grid until next problem
//   aiLockout       — pauses the AI opponent for durationMs (visible lock indicator)
//   petalShield     — forgives the next wrong tap (no grid lock) until used/next problem

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
      name: 'Mushroom Grove',
      kind: 'mushroomGrove',
      cooldownMs: 20_000,
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
      name: 'Sunfire Hold',
      kind: 'aiLockout',
      cooldownMs: 45_000,
      durationMs: 30_000,
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
      name: 'Crystal Flash',
      kind: 'lightningStrike',
      cooldownMs: 25_000,
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
      name: 'Petal Shield',
      kind: 'petalShield',
      cooldownMs: 25_000,
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
      // The strongest helper — pinpoints the exact answer — so it's the final
      // companion unlocked (storm_dragon is the last boss to grant one, node 41).
      name: "Storm's Eye",
      kind: 'revealAnswer',
      cooldownMs: 22_000,
      durationMs: 2_200,
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
