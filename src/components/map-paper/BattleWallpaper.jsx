import { useMemo } from 'react';
import { BATTLE_VIEWBOX } from './paperUtils';
import { BATTLE_WALLPAPER_OPACITY, getWorldMotifs } from './worldMotifs';

const { width: VIEWBOX_W, height: VIEWBOX_H } = BATTLE_VIEWBOX;


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
      <g opacity={BATTLE_WALLPAPER_OPACITY[worldId] ?? 0.22}>
        {motifs}
      </g>
    </svg>
  );
}
