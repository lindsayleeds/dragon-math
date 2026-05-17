import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { useAuth } from '../hooks/useAuth';
import {
  MAP_NODES,
  WORLDS,
  MAP_PATH,
  NODE_TYPE,
} from '../data/mapData';
import { deriveNodeState, NODE_STATE } from '../utils/nodeHelpers';
import styles from '../styles/MapPagePixel.module.css';

const SVG_WIDTH = 400;
const SVG_HEIGHT = 4700;

// Per-world pixel styling — tile pattern id + label border color + accent for
// the "world X" stat. Indexed by world.id.
const WORLD_STYLE = {
  1: { tileId: 'tileForest',  border: '#ffd24a', accent: '#7fe05f', stars: false },
  2: { tileId: 'tileHoney',   border: '#ff9e3a', accent: '#ffd24a', stars: false },
  3: { tileId: 'tileCaves',   border: '#5ce6f0', accent: '#c79bf0', stars: true  },
  4: { tileId: 'tileSakura',  border: '#ff8ec4', accent: '#ffb0d6', stars: false },
  5: { tileId: 'tileSky',     border: '#a8d8f0', accent: '#e8f4ff', stars: true  },
};

// ---------- Deterministic PRNG so starfields are stable across renders ----------
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Starfield restricted to a y-band (caves + sky worlds) ----------
function Starfield({ band, seed, palette, count }) {
  const stars = useMemo(() => {
    const rand = mulberry32(seed);
    const out = [];
    const height = band.bottom - band.top;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rand() * SVG_WIDTH);
      const y = Math.floor(band.top + rand() * (height - 6));
      const sizeRoll = rand();
      const size = sizeRoll < 0.65 ? 1 : sizeRoll < 0.92 ? 2 : 3;
      const color = palette[Math.floor(rand() * palette.length)];
      const blinks = rand() < 0.22;
      out.push({ id: i, x, y, size, color, blinks });
    }
    return out;
  }, [band.top, band.bottom, seed, palette, count]);

  return (
    <g>
      {stars.map(s => (
        <rect
          key={s.id}
          x={s.x}
          y={s.y}
          width={s.size}
          height={s.size}
          fill={s.color}
          className={s.blinks ? styles.blinkStar : undefined}
        />
      ))}
    </g>
  );
}

// ---------- Hard checker row at each world transition ----------
function CheckerDivider({ y, colorA, colorB }) {
  const cells = [];
  const cellW = 16;
  const count = SVG_WIDTH / cellW;
  for (let i = 0; i < count; i++) {
    cells.push(
      <rect
        key={`top-${y}-${i}`}
        x={i * cellW}
        y={y - 4}
        width={cellW}
        height={4}
        fill={i % 2 === 0 ? colorA : '#000'}
      />
    );
    cells.push(
      <rect
        key={`bot-${y}-${i}`}
        x={i * cellW}
        y={y}
        width={cellW}
        height={4}
        fill={i % 2 === 0 ? '#000' : colorB}
      />
    );
  }
  return <g shapeRendering="crispEdges">{cells}</g>;
}

// ---------- Pixel road: black under, gold dashed over, square caps ----------
function PixelRoad() {
  return (
    <g>
      <path
        d={MAP_PATH}
        fill="none"
        stroke="#000000"
        strokeWidth={10}
        strokeDasharray="8 6"
        strokeLinecap="butt"
      />
      <path
        d={MAP_PATH}
        fill="none"
        stroke="#ffd24a"
        strokeWidth={6}
        strokeDasharray="8 6"
        strokeLinecap="butt"
      />
    </g>
  );
}

// ---------- World label: black plate, thick colored border, Press Start 2P ----------
function PixelWorldLabel({ world }) {
  const style = WORLD_STYLE[world.id] || WORLD_STYLE[1];
  // Sit just below the wash's top edge so the label is inside the world.
  const y = world.bandY.top + 14;
  const plateW = 280;
  const plateH = 30;
  const plateX = (SVG_WIDTH - plateW) / 2;

  return (
    <g shapeRendering="crispEdges">
      <rect x={plateX + 4} y={y + 4} width={plateW} height={plateH} fill="#000" />
      <rect x={plateX} y={y} width={plateW} height={plateH} fill="#000" />
      <rect
        x={plateX + 3}
        y={y + 3}
        width={plateW - 6}
        height={plateH - 6}
        fill="none"
        stroke={style.border}
        strokeWidth={3}
      />
      <text
        x={SVG_WIDTH / 2}
        y={y + plateH / 2 + 4}
        textAnchor="middle"
        fontFamily="'Press Start 2P', monospace"
        fontSize={10}
        fill={style.border}
      >
        ▸ {world.name.toUpperCase()} ◂
      </text>
    </g>
  );
}

// ---------- Node: square sprite, 3px black border, white top highlight, hard shadow ----------
function PixelNode({ node, state, onClick, nodeRef }) {
  const isBoss = node.type === NODE_TYPE.BOSS;
  const isLocked = state === NODE_STATE.LOCKED;
  const isAvailable = state === NODE_STATE.AVAILABLE;
  const isCompleted = state === NODE_STATE.COMPLETED;

  const size = isBoss ? 56 : 40;
  const half = size / 2;
  const labelY = half + 14;

  let fill;
  if (isLocked) fill = '#404060';
  else if (isCompleted) fill = '#ffd24a';
  else if (isBoss) fill = '#ff4f99';
  else fill = '#5ce6f0';

  function handleClick() {
    if (!isLocked) onClick(node);
  }

  return (
    <g
      ref={nodeRef}
      transform={`translate(${node.x}, ${node.y})`}
      onClick={handleClick}
      style={{ cursor: isLocked ? 'default' : 'pointer' }}
      role={isLocked ? 'img' : 'button'}
      aria-label={`${node.label}${isLocked ? ' (locked)' : isCompleted ? ' (completed)' : ' (available)'}`}
      shapeRendering="crispEdges"
    >
      <rect x={-half + 4} y={-half + 4} width={size} height={size} fill="#000" />
      <rect x={-half} y={-half} width={size} height={size} fill="#000" />
      <rect
        x={-half + 3}
        y={-half + 3}
        width={size - 6}
        height={size - 6}
        fill={fill}
      />
      <rect
        x={-half + 3}
        y={-half + 3}
        width={size - 6}
        height={4}
        fill="#ffffff"
        opacity={isLocked ? 0.35 : 0.85}
      />

      {isLocked ? (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          y={2}
          fontFamily="'Press Start 2P', monospace"
          fontSize={isBoss ? 22 : 16}
          fill="#ffffff"
          opacity={0.35}
        >
          ?
        </text>
      ) : (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          y={2}
          fontSize={isBoss ? 26 : 18}
        >
          {node.icon}
        </text>
      )}

      {isCompleted && !isBoss && (
        <g transform={`translate(${half - 6}, ${-half - 6})`}>
          <rect x={-7} y={-1} width={14} height={14} fill="#000" />
          <rect x={-5} y={1} width={10} height={10} fill="#7fe05f" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            x={0}
            y={6}
            fontFamily="'Press Start 2P', monospace"
            fontSize={7}
            fill="#000"
          >
            {'✓'}
          </text>
        </g>
      )}

      {isAvailable && (
        <g className={styles.arrowBob}>
          <g transform={`translate(0, ${-half - 22})`} className={styles.arrowBlink} shapeRendering="crispEdges">
            <rect x={-10} y={0} width={20} height={4} fill="#ffd24a" />
            <rect x={-10} y={0} width={20} height={4} fill="none" stroke="#000" strokeWidth={1} />
            <rect x={-6} y={4} width={12} height={4} fill="#ffd24a" />
            <rect x={-6} y={4} width={12} height={4} fill="none" stroke="#000" strokeWidth={1} />
            <rect x={-2} y={8} width={4} height={4} fill="#ffd24a" />
            <rect x={-2} y={8} width={4} height={4} fill="none" stroke="#000" strokeWidth={1} />
          </g>
        </g>
      )}

      {isBoss && !isLocked && (
        <text
          textAnchor="middle"
          y={-half - 6}
          fontFamily="'Press Start 2P', monospace"
          fontSize={9}
          fill={isCompleted ? '#ffd24a' : '#ff4f99'}
        >
          ♛ BOSS ♛
        </text>
      )}

      <text
        textAnchor="middle"
        y={labelY + (isBoss ? 6 : 4)}
        fontFamily="'Press Start 2P', monospace"
        fontSize={6.5}
        fill={isLocked ? '#7a7a9a' : '#ffffff'}
        style={{ letterSpacing: '0.5px' }}
      >
        {node.label.toUpperCase()}
      </text>
    </g>
  );
}

// ---------- Tab strip: variant switcher ----------
function VariantTabs() {
  const { pathname } = useLocation();
  const tabs = [
    { to: '/map', label: 'V1' },
    { to: '/map2', label: 'V2' },
  ];
  return (
    <div className={styles.tabStrip}>
      {tabs.map(t => (
        <Link
          key={t.to}
          to={t.to}
          className={`${styles.tab} ${pathname === t.to ? styles.tabActive : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function worldForNodeId(nodeId) {
  return WORLDS.find(
    w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]
  );
}

// ---------- Page ----------
export function MapPagePixel() {
  const { progressMap, currentNodeId, username, loading } = useNodeProgress();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [selectedNode, setSelectedNode] = useState(null);
  const scrollRef = useRef(null);
  const availableNodeRef = useRef(null);

  const { totalStars, completedCount } = useMemo(() => {
    let stars = 0;
    let completed = 0;
    Object.values(progressMap).forEach(p => {
      if (p?.completed) {
        completed += 1;
        stars += p.stars || 0;
      }
    });
    return { totalStars: stars, completedCount: completed };
  }, [progressMap]);

  const nextNode = useMemo(
    () => MAP_NODES.find(n => n.id === currentNodeId),
    [currentNodeId]
  );

  const currentWorld = nextNode ? worldForNodeId(nextNode.id) : WORLDS[0];
  const currentWorldIndex = currentWorld ? WORLDS.indexOf(currentWorld) + 1 : 1;

  useEffect(() => {
    if (loading) return;
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const containerH = container.clientHeight;
    const svgH = container.scrollHeight;
    const targetNode = MAP_NODES.find(n => n.id === currentNodeId);
    if (!targetNode) return;
    const ratio = targetNode.y / SVG_HEIGHT;
    const scrollTarget = ratio * svgH - containerH / 2;
    container.scrollTop = Math.max(0, scrollTarget);
  }, [currentNodeId, loading]);

  function handleNodeClick(node) {
    setSelectedNode(node);
  }
  function handleCloseModal() {
    setSelectedNode(null);
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.loadingGlyph}>♦</span>
        <p className={styles.loadingText}>LOADING...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.scanlines} aria-hidden="true" />

      <VariantTabs />

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.titleArrow}>{'▼'}</span>
          <span className={styles.title}>DRAGON MATH</span>
          <span className={styles.titleArrow}>{'▼'}</span>
        </div>

        <div className={styles.headerCenter}>
          <span className={styles.stat}>
            <span className={styles.statGlyph} style={{ color: '#ffd24a' }}>★</span>
            <span className={styles.statValue}>{String(totalStars).padStart(3, '0')}</span>
          </span>
          <span className={styles.statSep}>|</span>
          <span className={styles.stat}>
            <span className={styles.statGlyph} style={{ color: '#ff4f99' }}>♛</span>
            <span className={styles.statValue}>{completedCount}/{MAP_NODES.length}</span>
          </span>
        </div>

        <div className={styles.headerRight}>
          <span className={styles.player}>
            P1&nbsp;&mdash;&nbsp;<span className={styles.playerName}>{(username || 'PLAYER').toUpperCase()}</span>
          </span>
          <button className={styles.exitBtn} onClick={logout} aria-label="Log out">
            <span className={styles.exitFull}>[EXIT]</span>
            <span className={styles.exitShort}>[X]</span>
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <aside className={styles.sideRail} aria-hidden="true">
          <div className={styles.railPanel}>
            <div className={styles.railHeader}>PLAYER</div>
            <div className={styles.railAvatar}>
              <div className={styles.avatarBox}>
                <div className={styles.avatarPixelArt} />
              </div>
              <div className={styles.avatarName}>{(username || 'PLAYER').toUpperCase()}</div>
            </div>
          </div>

          <div className={styles.railPanel}>
            <div className={styles.railHeader}>STATS</div>
            <ul className={styles.railList}>
              <li>
                <span className={styles.railKey}>STARS</span>
                <span className={styles.railVal} style={{ color: '#ffd24a' }}>
                  {String(totalStars).padStart(3, '0')}
                </span>
              </li>
              <li>
                <span className={styles.railKey}>QUESTS</span>
                <span className={styles.railVal} style={{ color: '#7fe05f' }}>
                  {completedCount}/{MAP_NODES.length}
                </span>
              </li>
              <li>
                <span className={styles.railKey}>WORLD</span>
                <span
                  className={styles.railVal}
                  style={{ color: WORLD_STYLE[currentWorld?.id || 1].border }}
                >
                  {currentWorldIndex}/{WORLDS.length}
                </span>
              </li>
            </ul>
          </div>

          <div className={styles.railPanel}>
            <div className={styles.railHeader}>NEXT QUEST</div>
            {nextNode ? (
              <div className={styles.nextQuest}>
                <div className={styles.nextIconBox}>
                  <span className={styles.nextIcon}>{nextNode.icon}</span>
                </div>
                <div className={styles.nextMeta}>
                  <div className={styles.nextLabel}>{nextNode.label.toUpperCase()}</div>
                  <div className={styles.nextType}>
                    {nextNode.type === NODE_TYPE.BOSS ? '!!! BOSS !!!' : 'MATH DUEL'}
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.nextDone}>&gt;&gt; ALL CLEAR</div>
            )}
          </div>

          <div className={styles.railFooter}>
            <span className={styles.railBlinker}>▶</span> PRESS [A] TO START
          </div>
        </aside>

        <div ref={scrollRef} className={styles.scrollContainer}>
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            shapeRendering="crispEdges"
            className={styles.svg}
          >
            <defs>
              {/* World 1 — Mushroom Forest: green grass tile */}
              <pattern id="tileForest" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#3b6b3b" />
                <rect x="2" y="3" width="2" height="2" fill="#4f8a4f" />
                <rect x="10" y="6" width="2" height="2" fill="#4f8a4f" />
                <rect x="6" y="11" width="2" height="2" fill="#2b5230" />
                <rect x="13" y="13" width="1" height="1" fill="#7fe05f" />
                <rect x="1" y="9" width="1" height="1" fill="#7fe05f" />
              </pattern>

              {/* World 2 — Honeyfield Plains: warm yellow meadow tile */}
              <pattern id="tileHoney" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#c8923a" />
                <rect x="3" y="4" width="2" height="2" fill="#dba94a" />
                <rect x="11" y="2" width="2" height="2" fill="#dba94a" />
                <rect x="7" y="10" width="2" height="2" fill="#f4d57a" />
                <rect x="13" y="12" width="1" height="1" fill="#f4d57a" />
                <rect x="2" y="13" width="1" height="1" fill="#7a5a20" />
                <rect x="9" y="14" width="1" height="1" fill="#7a5a20" />
              </pattern>

              {/* World 3 — Crystal Caves: dark cave tile (paired with starfield) */}
              <pattern id="tileCaves" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
                <rect width="32" height="32" fill="#0a0a1a" />
                <rect x="6" y="22" width="1" height="1" fill="#1a1a3a" />
                <rect x="21" y="10" width="1" height="1" fill="#1a1a3a" />
              </pattern>

              {/* World 4 — Sakura Vale: rose/petal tile */}
              <pattern id="tileSakura" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#b86e8a" />
                <rect x="3" y="3" width="2" height="2" fill="#c98aa3" />
                <rect x="10" y="5" width="2" height="2" fill="#e8b8cc" />
                <rect x="6" y="11" width="2" height="2" fill="#c98aa3" />
                <rect x="13" y="13" width="1" height="1" fill="#f7d6e5" />
                <rect x="2" y="14" width="1" height="1" fill="#7a3a55" />
              </pattern>

              {/* World 5 — Cloudspire Heights: sky-blue tile (paired with stars) */}
              <pattern id="tileSky" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#6ea8d4" />
                <rect x="3" y="4" width="3" height="2" fill="#d8eaf6" />
                <rect x="11" y="9" width="3" height="2" fill="#d8eaf6" />
                <rect x="8" y="13" width="2" height="1" fill="#a8c8e0" />
                <rect x="1" y="11" width="1" height="1" fill="#90c0e0" />
              </pattern>
            </defs>

            {/* Per-world tiled backdrops, painted bottom-up */}
            {WORLDS.map(world => (
              <rect
                key={`bg-${world.id}`}
                x={0}
                y={world.bandY.top}
                width={SVG_WIDTH}
                height={world.bandY.bottom - world.bandY.top}
                fill={`url(#${WORLD_STYLE[world.id].tileId})`}
              />
            ))}

            {/* Starfields only over the caves + sky bands */}
            {WORLDS.filter(w => WORLD_STYLE[w.id].stars).map(world => (
              <Starfield
                key={`stars-${world.id}`}
                band={world.bandY}
                seed={1337 + world.id * 101}
                palette={world.id === 5
                  ? ['#ffffff', '#fff4c0', '#a8d8f0']
                  : ['#ffffff', '#5ce6f0', '#ff4f99']
                }
                count={world.id === 5 ? 40 : 70}
              />
            ))}

            {/* Checker dividers at each world transition */}
            {WORLDS.slice(0, -1).map(lower => {
              const upper = WORLDS.find(w => w.bandY.bottom === lower.bandY.top);
              return (
                <CheckerDivider
                  key={`div-${lower.id}`}
                  y={lower.bandY.top}
                  colorA={WORLD_STYLE[lower.id].border}
                  colorB={upper ? WORLD_STYLE[upper.id].border : '#000'}
                />
              );
            })}

            <PixelRoad />

            {WORLDS.map(w => (
              <PixelWorldLabel key={w.id} world={w} />
            ))}

            {MAP_NODES.map(node => {
              const state = deriveNodeState(node.id, currentNodeId, progressMap);
              const isAvailable = state === NODE_STATE.AVAILABLE;
              return (
                <PixelNode
                  key={node.id}
                  node={node}
                  state={state}
                  onClick={handleNodeClick}
                  nodeRef={isAvailable ? availableNodeRef : null}
                />
              );
            })}
          </svg>
        </div>
      </main>

      {selectedNode && (
        <div className={styles.modalOverlay} onClick={handleCloseModal} role="dialog" aria-modal="true">
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeaderBar}>
              <span className={styles.modalHeaderTitle}>QUEST</span>
              <button
                className={styles.modalClose}
                onClick={handleCloseModal}
                aria-label="Close"
              >
                [X]
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalIconFrame}>
                <span className={styles.modalIcon}>{selectedNode.icon}</span>
              </div>

              <h2 className={styles.modalTitle}>{selectedNode.label.toUpperCase()}</h2>

              {selectedNode.type === NODE_TYPE.BOSS && (
                <p className={styles.modalBossBadge}>!!! BOSS !!!</p>
              )}

              <p className={styles.modalDesc}>
                <span className={styles.modalDescPrefix}>&gt;&gt;</span>{' '}
                {selectedNode.type === NODE_TYPE.BOSS
                  ? 'A FEARSOME DRAGON GUARDS THIS PASS. DEFEAT IT TO ADVANCE.'
                  : 'A MATH DUEL AWAITS. ANSWER FASTER THAN YOUR FOE TO WIN.'}
              </p>

              <button
                className={styles.modalPlayBtn}
                type="button"
                onClick={() => navigate(`/battle/${selectedNode.id}`)}
              >
                {selectedNode.type === NODE_TYPE.BOSS ? '▶ FIGHT [A]' : '▶ PLAY [A]'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapPagePixel;
