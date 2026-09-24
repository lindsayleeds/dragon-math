// Deterministic pseudo-random — stable wobble from an integer seed.
// Used for node jitter, torn-edge offsets, etc. so the layout is identical on
// every render but doesn't read as a perfect grid.
export function seeded(seed) {
  const x = Math.sin(seed * 9973.137) * 43758.5453;
  return x - Math.floor(x);
}

export const SVG_WIDTH = 400;
export const SVG_HEIGHT = 5700;

// Legacy single-tear constant — kept so any caller importing it still works,
// but the paper map now draws a tear at each world boundary (see WORLDS).
export const TORN_Y = 3805;

// ---------- static paper-map layers ------------------------------------------
// Values below are shared by the web map (MapPagePaper, PaperDefs,
// BattleWallpaper) and the iOS vector-art export in scripts/ios-art, so the
// exported assets can't drift from what the browser draws.

// Opacity of each world's flat watercolor wash over the cream paper.
export const WORLD_WASH_OPACITY = 0.42;

// Extra wash splotches for painterly depth, in map (SVG) coordinates.
export const WASH_SPLOTCHES = [
  { cx: 90, cy: 240, rx: 80, ry: 44, fill: '#cfd9e8', opacity: 0.32 },
  { cx: 310, cy: 1420, rx: 70, ry: 40, fill: '#e9c2cf', opacity: 0.30 },
  { cx: 200, cy: 2380, rx: 120, ry: 38, fill: '#cdb8dd', opacity: 0.26 },
  { cx: 100, cy: 3340, rx: 80, ry: 42, fill: '#e8c780', opacity: 0.30 },
  { cx: 300, cy: 4280, rx: 90, ry: 44, fill: '#bcd9b8', opacity: 0.28 },
];

// Dot-grid notebook overlay: one dot per `spacing` cell at (dotX, dotY) within
// the cell, drawn at `dotOpacity` inside a layer at `layerOpacity`.
export const DOT_GRID = {
  spacing: 20,
  dotX: 2,
  dotY: 2,
  r: 0.7,
  fill: '#a07859',
  dotOpacity: 0.22,
  layerOpacity: 0.4,
};

// Battle-screen wallpaper canvas (drawn with preserveAspectRatio "slice").
export const BATTLE_VIEWBOX = { width: 400, height: 800 };
