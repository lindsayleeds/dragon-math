export const NODE_TYPE = {
  REGULAR: 'regular',
  BOSS: 'boss',
};

// SVG viewBox: 0 0 400 4700. Nodes snake left/right down the canvas;
// high y = bottom of canvas = start of journey, low y = top = final boss.
//
// Each world's `bandY` describes the SVG y-range that the world occupies,
// so the map page can paint a per-biome wash without recomputing.
// `chapterY` is where the chapter-heading label is drawn (sits in the gap
// between the world's first and second regular nodes).
export const WORLDS = [
  {
    id: 1,
    name: 'Mushroom Forest',
    nodeRange: [1, 8],
    bgColor: '#c8efd8',
    accentColor: '#5a9e6f',
    washColor: '#c9e4c4',
    chapterColor: '#7d9d6c',
    bandY: { top: 3805, bottom: 4700 },
    chapterY: 4565,
    chapterX: 260,
  },
  {
    id: 2,
    name: 'Honeyfield Plains',
    nodeRange: [9, 16],
    bgColor: '#fff3b8',
    accentColor: '#d9923c',
    washColor: '#f4dc9c',
    chapterColor: '#b8852f',
    bandY: { top: 2905, bottom: 3805 },
    chapterY: 3685,
    chapterX: 295,
  },
  {
    id: 3,
    name: 'Crystal Caves',
    nodeRange: [17, 25],
    bgColor: '#ddd0f5',
    accentColor: '#8a5abf',
    washColor: '#d8d0ef',
    chapterColor: '#9d7fc4',
    bandY: { top: 1895, bottom: 2905 },
    chapterY: 2785,
    chapterX: 295,
  },
  {
    id: 4,
    name: 'Sakura Vale',
    nodeRange: [26, 33],
    bgColor: '#ffe1ec',
    accentColor: '#e57aa6',
    washColor: '#f4cedc',
    chapterColor: '#c78aa6',
    bandY: { top: 995, bottom: 1895 },
    chapterY: 1775,
    chapterX: 295,
  },
  {
    id: 5,
    name: 'Cloudspire Heights',
    nodeRange: [34, 41],
    bgColor: '#e6f3ff',
    accentColor: '#7fa6e8',
    washColor: '#d2e4f6',
    chapterColor: '#7fa6c4',
    bandY: { top: 0, bottom: 995 },
    chapterY: 875,
    chapterX: 295,
  },
];

export const MAP_NODES = [
  // World 1 — Mushroom Forest
  { id: 1,  type: NODE_TYPE.REGULAR, label: 'Meadow Gate',     icon: '🏡', x: 200, y: 4640 },
  { id: 2,  type: NODE_TYPE.REGULAR, label: 'Firefly Glen',    icon: '🌿', x: 110, y: 4530 },
  { id: 3,  type: NODE_TYPE.REGULAR, label: 'Toadstool Inn',   icon: '🍄', x: 270, y: 4420 },
  { id: 4,  type: NODE_TYPE.REGULAR, label: 'Mossy Tower',     icon: '🗼', x: 120, y: 4310 },
  { id: 5,  type: NODE_TYPE.REGULAR, label: 'Dewdrop Pond',    icon: '💧', x: 260, y: 4200 },
  { id: 6,  type: NODE_TYPE.REGULAR, label: 'Spore Hollow',    icon: '🌑', x: 115, y: 4090 },
  { id: 7,  type: NODE_TYPE.REGULAR, label: 'Hedgehog Hollow', icon: '🦔', x: 265, y: 3980 },
  { id: 8,  type: NODE_TYPE.BOSS,    label: 'Forest Dragon',   icon: '🐲', x: 200, y: 3870 },

  // World 2 — Honeyfield Plains
  { id: 9,  type: NODE_TYPE.REGULAR, label: 'Sunflower Field',     icon: '🌻', x: 200, y: 3740 },
  { id: 10, type: NODE_TYPE.REGULAR, label: 'Honeycomb Hive',      icon: '🍯', x: 110, y: 3630 },
  { id: 11, type: NODE_TYPE.REGULAR, label: 'Butterfly Bridge',    icon: '🦋', x: 270, y: 3520 },
  { id: 12, type: NODE_TYPE.REGULAR, label: "Beekeeper's Cottage", icon: '🏡', x: 120, y: 3410 },
  { id: 13, type: NODE_TYPE.REGULAR, label: 'Wildflower Knoll',    icon: '🌼', x: 260, y: 3300 },
  { id: 14, type: NODE_TYPE.REGULAR, label: 'Golden Pond',         icon: '🦆', x: 115, y: 3190 },
  { id: 15, type: NODE_TYPE.REGULAR, label: "Lark's Hollow",       icon: '🐦', x: 265, y: 3080 },
  { id: 16, type: NODE_TYPE.BOSS,    label: 'Sunfire Dragon',      icon: '🐲', x: 200, y: 2970 },

  // World 3 — Crystal Caves (renumbered from 9–17 to 17–25)
  { id: 17, type: NODE_TYPE.REGULAR, label: 'Crystal Pass',   icon: '💎', x: 200, y: 2840 },
  { id: 18, type: NODE_TYPE.REGULAR, label: 'Gem Grotto',     icon: '🔮', x: 115, y: 2730 },
  { id: 19, type: NODE_TYPE.REGULAR, label: 'Prism Falls',    icon: '🌊', x: 265, y: 2620 },
  { id: 20, type: NODE_TYPE.REGULAR, label: 'Echo Chamber',   icon: '🗿', x: 120, y: 2510 },
  { id: 21, type: NODE_TYPE.REGULAR, label: 'Sapphire Mine',  icon: '⛏️', x: 260, y: 2400 },
  { id: 22, type: NODE_TYPE.REGULAR, label: 'Ice Pinnacle',   icon: '❄️', x: 125, y: 2290 },
  { id: 23, type: NODE_TYPE.REGULAR, label: 'Moon Shrine',    icon: '🌙', x: 255, y: 2180 },
  { id: 24, type: NODE_TYPE.REGULAR, label: 'Star Garden',    icon: '⭐', x: 170, y: 2070 },
  { id: 25, type: NODE_TYPE.BOSS,    label: 'Crystal Dragon', icon: '🐉', x: 200, y: 1960 },

  // World 4 — Sakura Vale
  { id: 26, type: NODE_TYPE.REGULAR, label: 'Petal Path',     icon: '🌸', x: 200, y: 1830 },
  { id: 27, type: NODE_TYPE.REGULAR, label: 'Koi Pond',       icon: '🐟', x: 110, y: 1720 },
  { id: 28, type: NODE_TYPE.REGULAR, label: 'Lantern Bridge', icon: '🏮', x: 270, y: 1610 },
  { id: 29, type: NODE_TYPE.REGULAR, label: 'Tea Pavilion',   icon: '🍵', x: 120, y: 1500 },
  { id: 30, type: NODE_TYPE.REGULAR, label: 'Bamboo Grove',   icon: '🎋', x: 260, y: 1390 },
  { id: 31, type: NODE_TYPE.REGULAR, label: "Crane's Roost",  icon: '🕊️', x: 115, y: 1280 },
  { id: 32, type: NODE_TYPE.REGULAR, label: 'Misty Summit',   icon: '⛰️', x: 265, y: 1170 },
  { id: 33, type: NODE_TYPE.BOSS,    label: 'Sakura Dragon',  icon: '🐲', x: 200, y: 1060 },

  // World 5 — Cloudspire Heights
  { id: 34, type: NODE_TYPE.REGULAR, label: 'Cloud Landing',      icon: '☁️', x: 200, y: 930 },
  { id: 35, type: NODE_TYPE.REGULAR, label: 'Rainbow Span',       icon: '🌈', x: 110, y: 820 },
  { id: 36, type: NODE_TYPE.REGULAR, label: 'Wishing-Star Steps', icon: '✨', x: 270, y: 710 },
  { id: 37, type: NODE_TYPE.REGULAR, label: 'Pegasus Glade',      icon: '🦄', x: 120, y: 600 },
  { id: 38, type: NODE_TYPE.REGULAR, label: 'Windchime Bluff',    icon: '🎐', x: 260, y: 490 },
  { id: 39, type: NODE_TYPE.REGULAR, label: 'Aurora Tower',       icon: '🗼', x: 115, y: 380 },
  { id: 40, type: NODE_TYPE.REGULAR, label: 'Zephyr Peak',        icon: '🪁', x: 265, y: 270 },
  { id: 41, type: NODE_TYPE.BOSS,    label: 'Storm Dragon',       icon: '🐉', x: 200, y: 160 },
];

// Smooth S-curve through every node. Each segment is a cubic bezier with
// control points placed vertically along each endpoint's x so the road eases
// out of one node and into the next without overshooting.
function buildPath(nodes) {
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const dy = b.y - a.y;
    const c1y = (a.y + dy * 0.45).toFixed(0);
    const c2y = (a.y + dy * 0.55).toFixed(0);
    d += ` C ${a.x} ${c1y}, ${b.x} ${c2y}, ${b.x} ${b.y}`;
  }
  return d;
}

export const MAP_PATH = buildPath(MAP_NODES);
