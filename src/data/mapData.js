export const NODE_TYPE = {
  REGULAR: 'regular',
  BOSS: 'boss',
};

export const WORLDS = [
  { id: 1, name: 'Mushroom Forest', nodeRange: [1, 8],  bgColor: '#c8efd8', accentColor: '#5a9e6f' },
  { id: 2, name: 'Crystal Caves',   nodeRange: [9, 17], bgColor: '#ddd0f5', accentColor: '#8a5abf' },
];

// SVG viewBox: 0 0 400 1800
// Nodes snake left/right down the canvas (high y = bottom = start of game)
export const MAP_NODES = [
  // World 1 — Mushroom Forest (nodes 1–7 regular, 8 boss)
  { id: 1,  type: NODE_TYPE.REGULAR, label: 'Meadow Gate',   icon: '🏡', x: 200, y: 1720 },
  { id: 2,  type: NODE_TYPE.REGULAR, label: 'Firefly Glen',  icon: '🌿', x: 110, y: 1590 },
  { id: 3,  type: NODE_TYPE.REGULAR, label: 'Toadstool Inn', icon: '🍄', x: 270, y: 1470 },
  { id: 4,  type: NODE_TYPE.REGULAR, label: 'Mossy Tower',   icon: '🗼', x: 120, y: 1350 },
  { id: 5,  type: NODE_TYPE.REGULAR, label: 'Dewdrop Pond',  icon: '💧', x: 260, y: 1230 },
  { id: 6,  type: NODE_TYPE.REGULAR, label: 'Spore Hollow',  icon: '🌑', x: 115, y: 1110 },
  { id: 7,  type: NODE_TYPE.REGULAR, label: 'Witch Hut',     icon: '🧙', x: 265, y: 1000 },
  { id: 8,  type: NODE_TYPE.BOSS,    label: 'Forest Dragon', icon: '🐲', x: 200, y: 880  },

  // World 2 — Crystal Caves (nodes 9–16 regular, 17 boss)
  { id: 9,  type: NODE_TYPE.REGULAR, label: 'Crystal Pass',  icon: '💎', x: 200, y: 760  },
  { id: 10, type: NODE_TYPE.REGULAR, label: 'Gem Grotto',    icon: '🔮', x: 115, y: 650  },
  { id: 11, type: NODE_TYPE.REGULAR, label: 'Prism Falls',   icon: '🌊', x: 265, y: 555  },
  { id: 12, type: NODE_TYPE.REGULAR, label: 'Echo Chamber',  icon: '🗿', x: 120, y: 465  },
  { id: 13, type: NODE_TYPE.REGULAR, label: 'Sapphire Mine', icon: '⛏️', x: 260, y: 378  },
  { id: 14, type: NODE_TYPE.REGULAR, label: 'Ice Pinnacle',  icon: '❄️', x: 125, y: 295  },
  { id: 15, type: NODE_TYPE.REGULAR, label: 'Moon Shrine',   icon: '🌙', x: 255, y: 218  },
  { id: 16, type: NODE_TYPE.REGULAR, label: 'Star Garden',   icon: '⭐', x: 170, y: 140  },
  { id: 17, type: NODE_TYPE.BOSS,    label: 'Crystal Dragon',icon: '🐉', x: 200, y: 55   },
];

// SVG path that winds through all node positions (cubic beziers)
export const MAP_PATH = `
  M 200 1720
  C 200 1670, 70 1630, 110 1590
  C 150 1550, 310 1510, 270 1470
  C 230 1430, 80 1390, 120 1350
  C 160 1310, 300 1270, 260 1230
  C 220 1190, 75 1150, 115 1110
  C 155 1070, 305 1035, 265 1000
  C 230 970,  170 930,  200 880
  C 230 830,  200 800,  200 760
  C 200 710,  75 670,  115 650
  C 155 630,  305 590,  265 555
  C 225 520,  80 490,  120 465
  C 160 440,  300 410,  260 378
  C 220 346,  85 316,  125 295
  C 165 274,  295 245,  255 218
  C 215 191,  130 165,  170 140
  C 190 125,  200 90,   200 55
`;
