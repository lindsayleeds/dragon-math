import styles from '../styles/MonsterMuncher.module.css';

/**
 * A friendly "number gobbler" critter for Dragon Munchers.
 *
 * It has five looking states driven by the `facing` prop:
 *   'center' — looking dead-on at the player (resting)
 *   'left' | 'right' | 'up' | 'down' — looking the way it is about to move
 *
 * The eyes/pupils shift toward `facing` and the whole body leans that way,
 * so when the game telegraphs a move the critter visibly "looks" before it goes.
 */

// Pupil offset (in SVG units) for each facing direction.
const PUPIL_OFFSET = {
  center: { x: 0, y: 0 },
  left: { x: -4, y: 0 },
  right: { x: 4, y: 0 },
  up: { x: 0, y: -4 },
  down: { x: 0, y: 4 },
};

export function MonsterMuncher({ facing = 'center', size = 'small' }) {
  const sizeClass = `size-${size}`;
  const leanClass = styles[`lean-${facing}`] || '';
  const offset = PUPIL_OFFSET[facing] || PUPIL_OFFSET.center;

  return (
    <div className={`${styles.monsterContainer} ${styles[sizeClass]} ${leanClass}`}>
      <svg
        viewBox="0 0 200 220"
        className={styles.monsterSvg}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="monsterSketch">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>

        {/* Feet */}
        <ellipse cx="72" cy="195" rx="20" ry="14" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" filter="url(#monsterSketch)" />
        <ellipse cx="128" cy="195" rx="20" ry="14" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" filter="url(#monsterSketch)" />

        {/* Antennae (friendly, bright — not horns) */}
        <path d="M 78 40 Q 68 18 60 8" stroke="#3d3528" strokeWidth="3" fill="none" strokeLinecap="round" filter="url(#monsterSketch)" />
        <circle cx="60" cy="8" r="6" fill="#d4a957" stroke="#3d3528" strokeWidth="2" />
        <path d="M 122 40 Q 132 18 140 8" stroke="#3d3528" strokeWidth="3" fill="none" strokeLinecap="round" filter="url(#monsterSketch)" />
        <circle cx="140" cy="8" r="6" fill="#d4a957" stroke="#3d3528" strokeWidth="2" />

        {/* Round body */}
        <circle cx="100" cy="115" r="80" fill="#c79bb8" stroke="#3d3528" strokeWidth="3.5" filter="url(#monsterSketch)" />

        {/* Belly highlight */}
        <ellipse cx="88" cy="95" rx="40" ry="34" fill="#dcb8d2" opacity="0.5" filter="url(#monsterSketch)" />

        {/* Spots for character */}
        <circle cx="135" cy="135" r="9" fill="#b886a8" opacity="0.7" />
        <circle cx="70" cy="150" r="7" fill="#b886a8" opacity="0.7" />

        {/* Eye whites */}
        <circle cx="78" cy="92" r="22" fill="#fdfaf2" stroke="#3d3528" strokeWidth="2.5" filter="url(#monsterSketch)" />
        <circle cx="122" cy="92" r="22" fill="#fdfaf2" stroke="#3d3528" strokeWidth="2.5" filter="url(#monsterSketch)" />

        {/* Pupils — shift toward the facing direction */}
        <g className={styles.pupils} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
          <circle cx="78" cy="92" r="9" fill="#3d3528" />
          <circle cx="81" cy="89" r="3" fill="#fdfaf2" />
          <circle cx="122" cy="92" r="9" fill="#3d3528" />
          <circle cx="125" cy="89" r="3" fill="#fdfaf2" />
        </g>

        {/* Grinning mouth (goofy, not scary) */}
        <path
          d="M 72 140 Q 100 168 128 140 Q 100 152 72 140 Z"
          fill="#8a4a5c"
          stroke="#3d3528"
          strokeWidth="2.5"
          strokeLinejoin="round"
          filter="url(#monsterSketch)"
        />
        {/* Two little teeth */}
        <path d="M 86 142 L 90 152 L 94 142 Z" fill="#fdfaf2" />
        <path d="M 106 142 L 110 152 L 114 142 Z" fill="#fdfaf2" />
      </svg>
    </div>
  );
}
