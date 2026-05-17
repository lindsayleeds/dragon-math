import { forwardRef } from 'react';
import { NODE_STATE } from '../../utils/nodeHelpers';
import { NODE_TYPE } from '../../data/mapData';
import styles from '../../styles/MapNode.module.css';

export const MapNode = forwardRef(function MapNode({ node, state, onClick }, ref) {
  const isBoss = node.type === NODE_TYPE.BOSS;
  const r = isBoss ? 38 : 26;
  const isLocked = state === NODE_STATE.LOCKED;
  const isAvailable = state === NODE_STATE.AVAILABLE;
  const isCompleted = state === NODE_STATE.COMPLETED;

  function handleClick() {
    if (!isLocked) onClick(node);
  }

  return (
    <g
      ref={ref}
      transform={`translate(${node.x}, ${node.y})`}
      className={`${styles.nodeGroup} ${isAvailable ? styles.available : ''} ${isBoss && isAvailable ? styles.bossAvailable : ''}`}
      onClick={handleClick}
      style={{ cursor: isLocked ? 'default' : 'pointer' }}
      role={isLocked ? 'img' : 'button'}
      aria-label={`${node.label}${isLocked ? ' (locked)' : isCompleted ? ' (completed)' : ' (available)'}`}
    >
      {/* Glow ring for available nodes */}
      {isAvailable && (
        <circle
          r={r + 10}
          fill="none"
          stroke={isBoss ? '#9b4dca' : '#ff9fd4'}
          strokeWidth="3"
          opacity="0.6"
          className={styles.glowRing}
        />
      )}

      {/* Main circle */}
      <circle
        r={r}
        fill={
          isLocked ? '#c8c8c8'
          : isBoss ? (isCompleted ? '#b388ff' : '#7c3aed')
          : isCompleted ? '#ffe066'
          : '#ff9fd4'
        }
        stroke={
          isBoss ? (isAvailable ? '#6d28d9' : '#9b4dca')
          : isCompleted ? '#e6a800'
          : isAvailable ? '#e05fa0'
          : '#aaaaaa'
        }
        strokeWidth={isBoss ? 4 : 3}
        opacity={isLocked ? 0.45 : 1}
      />

      {/* Icon */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isBoss ? 22 : 16}
        opacity={isLocked ? 0.4 : 1}
      >
        {isCompleted && !isBoss ? '⭐' : node.icon}
      </text>

      {/* Star badge on completed non-boss */}
      {isCompleted && !isBoss && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          y={r + 10}
          fill="#e6a800"
          fontWeight="bold"
        >
          ✓
        </text>
      )}

      {/* Node label */}
      <text
        textAnchor="middle"
        y={r + 16}
        fontSize={isBoss ? 11 : 9.5}
        fill={isLocked ? '#888' : isBoss ? '#3d2b5a' : '#3d2b5a'}
        fontWeight={isBoss ? '700' : '600'}
        fontFamily="inherit"
        opacity={isLocked ? 0.5 : 1}
      >
        {node.label}
      </text>
    </g>
  );
});
