import { useMemo } from 'react';
import { WORLDS } from '../../data/mapData';
import { MAP_WALLPAPER_OPACITY, SCATTERERS } from './worldMotifs';

// The per-world atmospheric "wallpaper" drawn beneath the path and nodes. The
// motif artwork and the seeded scatter functions live in ./worldMotifs.jsx —
// this file holds only the component, so Fast Refresh can keep map state while
// the wallpaper is being tweaked.

export function WorldWallpaper() {
  const motifs = useMemo(() => {
    return WORLDS.map(world => {
      const fn = SCATTERERS[world.id];
      return {
        id: world.id,
        opacity: MAP_WALLPAPER_OPACITY[world.id] ?? 0.4,
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
