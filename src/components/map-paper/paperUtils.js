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
