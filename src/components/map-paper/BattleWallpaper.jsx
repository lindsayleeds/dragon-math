import { useMemo } from 'react';
import { getWorldMotifs } from './WorldWallpaper';

const VIEWBOX_W = 400;
const VIEWBOX_H = 800;

// Slightly lower than the map so motifs don't compete with game UI.
const WORLD_OPACITY = { 1: 0.22, 2: 0.22, 3: 0.28, 4: 0.24, 5: 0.28, 6: 0.24 };

export function BattleWallpaper({ worldId }) {
  const motifs = useMemo(
    () => getWorldMotifs(worldId, { top: 0, bottom: VIEWBOX_H }),
    [worldId],
  );

  if (!worldId || motifs.length === 0) return null;

  return (
    <svg
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <g opacity={WORLD_OPACITY[worldId] ?? 0.22}>
        {motifs}
      </g>
    </svg>
  );
}
