import { NODE_TYPE } from '../../data/mapData';
import { NODE_STATE } from '../../utils/nodeHelpers';
import { seeded } from './paperUtils';
import styles from '../../styles/MapPagePaper.module.css';

// Hand-drawn crayon node. Layered:
//   1. soft drop shadow (wobbled)
//   2. main crayon fill circle (wobbled, slightly rotated)
//   3. hand-drawn outline (wobbled)
//   4. waxy highlight streak
//   5. icon (always visible — faded if locked)
//   6. completed "stamp" with ✓ in the corner
//   7. caveat label below
// The bobbing animation lives on an inner <g> so the CSS transform doesn't
// fight the outer SVG translate() that positions the node.
export function PaperNode({ node, state, onClick, isCurrent }) {
  const isBoss = node.type === NODE_TYPE.BOSS;
  const isLocked = state === NODE_STATE.LOCKED;
  const isAvailable = state === NODE_STATE.AVAILABLE;
  const isCompleted = state === NODE_STATE.COMPLETED;

  // small deterministic wobble — so nodes don't sit on a perfect grid
  const wobX = (seeded(node.id * 7) - 0.5) * 3;
  const wobY = (seeded(node.id * 11 + 1) - 0.5) * 3;
  const tilt = (seeded(node.id * 13) - 0.5) * 5;

  const r = isBoss ? 36 : 25;

  let fill;
  if (isLocked) fill = '#c4b290';                       // faded kraft
  else if (isCompleted && isBoss) fill = '#c79bb8';     // muted lavender
  else if (isCompleted) fill = '#d4a957';               // mustard
  else if (isBoss) fill = '#d97474';                    // rose
  else fill = '#7d9d6c';                                // sage

  function handleClick(e) {
    e.stopPropagation();
    if (!isLocked) onClick(node);
  }

  return (
    <g
      transform={`translate(${node.x + wobX}, ${node.y + wobY})`}
      className={`${styles.nodeGroup} ${!isLocked ? styles.nodeClickable : ''}`}
      onClick={handleClick}
      role={isLocked ? 'img' : 'button'}
      aria-label={`${node.label}${isLocked ? ' (locked)' : isCompleted ? ' (completed)' : ' (available)'}`}
    >
      <g className={isAvailable ? styles.bobbing : undefined}>
        {/* sketchy pulsing ring on the available node */}
        {isAvailable && (
          <circle
            r={r + 9}
            fill="none"
            stroke="#d97474"
            strokeWidth={2}
            strokeDasharray="3 4"
            opacity={0.85}
            className={styles.pulseRing}
            filter="url(#paperWobble)"
            transform={`rotate(${tilt})`}
          />
        )}

        {/* drop shadow */}
        <circle
          r={r}
          cx={2}
          cy={3}
          fill="#3d3528"
          opacity={isLocked ? 0.08 : 0.15}
          filter="url(#paperWobble)"
        />

        {/* crayon fill */}
        <circle
          r={r}
          fill={fill}
          opacity={isLocked ? 0.55 : 0.95}
          filter="url(#paperWobble)"
          transform={`rotate(${tilt})`}
        />

        {/* hand-drawn outline */}
        <circle
          r={r}
          fill="none"
          stroke="#3d3528"
          strokeWidth={2}
          opacity={isLocked ? 0.45 : 0.95}
          filter="url(#paperWobble)"
        />

        {/* waxy crayon highlight */}
        <ellipse
          cx={-r * 0.32}
          cy={-r * 0.4}
          rx={r * 0.45}
          ry={r * 0.18}
          fill="#fff8e2"
          opacity={isLocked ? 0.1 : 0.28}
          filter="url(#paperWobble)"
          transform={`rotate(${tilt - 18})`}
        />

        {/* icon — kept visible (faded) even when locked, per paper aesthetic */}
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={isBoss ? 26 : 18}
          opacity={isLocked ? 0.3 : 1}
          style={{ pointerEvents: 'none' }}
        >
          {node.icon}
        </text>

        {/* completion stamp */}
        {isCompleted && (
          <g
            transform={`translate(${r * 0.78}, ${-r * 0.78}) rotate(${tilt - 12})`}
            filter="url(#paperWobble)"
          >
            <circle r={11} fill="#d4a957" opacity={0.95} />
            <circle r={11} fill="none" stroke="#3d3528" strokeWidth={1.4} />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={14}
              fontFamily="'Caveat', cursive"
              fontWeight={700}
              fill="#3d3528"
            >
              ✓
            </text>
          </g>
        )}

        {/* node label */}
        <text
          textAnchor="middle"
          y={r + 18}
          fontFamily="'Caveat', cursive"
          fontWeight={700}
          fontSize={isBoss ? 16 : 14}
          fill="#3d3528"
          opacity={isLocked ? 0.55 : 1}
          style={{ pointerEvents: 'none' }}
        >
          {node.label}
        </text>

        {/* "you →" annotation on the current node */}
        {isCurrent && (
          <text
            x={-r - 14}
            y={2}
            fontFamily="'Caveat', cursive"
            fontWeight={700}
            fontSize={18}
            fill="#d97474"
            textAnchor="end"
            transform={`rotate(-6 ${-r - 14} 2)`}
            style={{ pointerEvents: 'none' }}
          >
            you →
          </text>
        )}
      </g>
    </g>
  );
}
