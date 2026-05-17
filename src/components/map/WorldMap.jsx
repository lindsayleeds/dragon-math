import { useRef, useEffect } from 'react';
import { MAP_NODES, WORLDS } from '../../data/mapData';
import { deriveNodeState, NODE_STATE } from '../../utils/nodeHelpers';
import { MapPath } from './MapPath';
import { MapNode } from './MapNode';
import { WorldLabel } from './WorldLabel';
import styles from '../../styles/WorldMap.module.css';

const SVG_WIDTH = 400;
const SVG_HEIGHT = 1800;

export function WorldMap({ progressMap, currentNodeId, onNodeClick }) {
  const scrollRef = useRef(null);
  const availableNodeRef = useRef(null);

  // Auto-scroll to available node on load
  useEffect(() => {
    if (!scrollRef.current || !availableNodeRef.current) return;
    const container = scrollRef.current;
    const containerH = container.clientHeight;
    const svgH = container.scrollHeight;
    const availableNode = MAP_NODES.find(n => n.id === currentNodeId);
    if (!availableNode) return;
    // Map node.y (SVG coords) to scroll position
    const ratio = availableNode.y / SVG_HEIGHT;
    const scrollTarget = ratio * svgH - containerH / 2;
    container.scrollTop = Math.max(0, scrollTarget);
  }, [currentNodeId]);

  return (
    <div ref={scrollRef} className={styles.scrollContainer}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className={styles.svg}
      >
        {/* World backgrounds */}
        <defs>
          <linearGradient id="world1Grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4f5e2" />
            <stop offset="100%" stopColor="#b8edcc" />
          </linearGradient>
          <linearGradient id="world2Grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8d9ff" />
            <stop offset="100%" stopColor="#d4c0f5" />
          </linearGradient>
          {/* Soft watercolor blur filter */}
          <filter id="softBlur">
            <feGaussianBlur stdDeviation="0.8" />
          </filter>
        </defs>

        {/* World 1 background (lower half — Mushroom Forest) */}
        <rect x={0} y={820} width={SVG_WIDTH} height={SVG_HEIGHT - 820}
          fill="url(#world1Grad)" />

        {/* World 2 background (upper half — Crystal Caves) */}
        <rect x={0} y={0} width={SVG_WIDTH} height={820}
          fill="url(#world2Grad)" />

        {/* Decorative trees for world 1 */}
        {[30, 60, 340, 370, 50, 350].map((x, i) => (
          <text key={i} x={x} y={[1650, 1400, 1550, 1300, 1100, 950][i]}
            fontSize="18" opacity="0.25">🌲</text>
        ))}

        {/* Decorative crystals for world 2 */}
        {[30, 370, 40, 360].map((x, i) => (
          <text key={i} x={x} y={[700, 600, 400, 200][i]}
            fontSize="14" opacity="0.2">💎</text>
        ))}

        {/* Road */}
        <MapPath />

        {/* World divider labels */}
        {WORLDS.map(world => (
          <WorldLabel key={world.id} world={world} />
        ))}

        {/* Nodes */}
        {MAP_NODES.map(node => {
          const state = deriveNodeState(node.id, currentNodeId, progressMap);
          const isAvailable = state === NODE_STATE.AVAILABLE;
          return (
            <MapNode
              key={node.id}
              node={node}
              state={state}
              onClick={onNodeClick}
              ref={isAvailable ? availableNodeRef : null}
            />
          );
        })}
      </svg>
    </div>
  );
}
