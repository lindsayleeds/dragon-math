import { useMemo } from 'react';
import { WORLDS } from '../../data/mapData';
import { SCATTERERS } from './worldMotifs';

// The per-world atmospheric "wallpaper" drawn beneath the path and nodes. The
// motif artwork and the seeded scatter functions live in ./worldMotifs.jsx —
// this file holds only the component, so Fast Refresh can keep map state while
// the wallpaper is being tweaked.

// Per-world wallpaper opacity. Crystal Caves and Cloudspire read better a
// hair brighter because their motifs are airier; the forest stays softer so
// mushrooms don't shout over the path.
const WORLD_OPACITY = {
  1: 0.42,
  2: 0.40,
  3: 0.48,
  4: 0.46,
  5: 0.50,
  6: 0.45,
};

export function WorldWallpaper() {
  const motifs = useMemo(() => {
    return WORLDS.map(world => {
      const fn = SCATTERERS[world.id];
      return {
        id: world.id,
        opacity: WORLD_OPACITY[world.id] ?? 0.4,
        elements: fn ? fn(world) : [],
      };
    });
  }, []);

  return (
    <g aria-hidden style={{ pointerEvents: 'none' }}>
      {motifs.map(m => (
        <g key={`wp-${m.id}`} opacity={m.opacity}>
          {m.elements}
        </g>
      ))}
    </g>
  );
}
