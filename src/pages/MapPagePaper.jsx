import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { useCompanionContext } from '../contexts/CompanionContext';
import { MAP_NODES, WORLDS, NODE_TYPE } from '../data/mapData';
import { COMPANIONS } from '../data/companions';
import { deriveNodeState, NODE_STATE } from '../utils/nodeHelpers';
import { PaperDefs } from '../components/map-paper/PaperDefs';
import { PencilRoad } from '../components/map-paper/PencilRoad';
import { TornEdge } from '../components/map-paper/TornEdge';
import { Doodles } from '../components/map-paper/Doodles';
import { WorldChapter } from '../components/map-paper/WorldChapter';
import { WorldWallpaper } from '../components/map-paper/WorldWallpaper';
import { PaperNode } from '../components/map-paper/PaperNode';
import { ProfileModal } from '../components/profile/ProfileModal';
import { SVG_WIDTH, SVG_HEIGHT } from '../components/map-paper/paperUtils';
import styles from '../styles/MapPagePaper.module.css';
import { renderAvatar } from '../utils/avatar';

const CHAPTER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];

// Order companions appear in the collection. Pip first, then bosses in world
// order (matches the map progression).
const COMPANION_ORDER = ['pip', 'forest_dragon', 'sunfire_dragon', 'crystal_dragon', 'sakura_dragon', 'storm_dragon'];

function worldForNodeId(nodeId) {
  return WORLDS.find(
    w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]
  );
}

export function MapPagePaper() {
  const { progressMap, currentNodeId, username, loading } = useNodeProgress();
  const { user } = useAuthContext();
  const { logout } = useAuth();
  const { activeId, setActive, ownsCompanion } = useCompanionContext();
  const navigate = useNavigate();
  const [selectedNode, setSelectedNode] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [companionError, setCompanionError] = useState(null);
  const scrollRef = useRef(null);
  const avatar = user?.avatar || '⚔️';

  // Auto-scroll to the available node. Every node sits at a known SVG y on a
  // 4700-unit canvas, so we map ratio → scrollHeight directly.
  useEffect(() => {
    if (loading) return;
    const container = scrollRef.current;
    if (!container) return;
    const node = MAP_NODES.find(n => n.id === currentNodeId);
    if (!node) return;
    const ratio = node.y / SVG_HEIGHT;
    const scrollTarget = ratio * container.scrollHeight - container.clientHeight / 2;
    container.scrollTop = Math.max(0, scrollTarget);
  }, [currentNodeId, loading]);

  const completedCount = useMemo(
    () =>
      MAP_NODES.filter(
        n => deriveNodeState(n.id, currentNodeId, progressMap) === NODE_STATE.COMPLETED
      ).length,
    [currentNodeId, progressMap]
  );

  const currentNode = useMemo(
    () => MAP_NODES.find(n => n.id === currentNodeId),
    [currentNodeId]
  );

  async function handleSelectCompanion(id) {
    if (!ownsCompanion(id) || id === activeId) return;
    try {
      setCompanionError(null);
      await setActive(id);
    } catch (err) {
      setCompanionError(err.message);
    }
  }

  const currentWorld = currentNode ? worldForNodeId(currentNode.id) : null;
  const currentChapter = currentWorld
    ? CHAPTER_WORDS[WORLDS.indexOf(currentWorld)] || '—'
    : '—';

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.loadingGlyph}>✦</span>
        <p className={styles.loadingText}>turning the page...</p>
      </div>
    );
  }

  const isBossSelected = selectedNode?.type === NODE_TYPE.BOSS;

  return (
    <div className={styles.page}>
      {/* ============================================================
          HEADER — journal top with washi tape & nav tabs
          ============================================================ */}
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />

        <div className={styles.headerLeft}>
          <div className={styles.brandRow}>
            <span className={styles.brandDragon} aria-hidden>🐉</span>
            <span className={styles.brandTitleWrap}>
              <span className={styles.brandTitle}>My Dragon Math</span>
            </span>
          </div>
          <span className={styles.brandSubtitle}>— a hand-drawn adventure</span>
        </div>

        <div className={styles.headerRight}>
          <button className={styles.homeTab} onClick={() => navigate('/home')}>
            ⌂ home
          </button>
          <span className={styles.questCounter}>
            {completedCount} / {MAP_NODES.length} quests
          </span>
          <button
            className={styles.menuBtn}
            onClick={() => setMenuOpen(true)}
            aria-label="Open field notes"
          >
            ☰
          </button>
          <button className={styles.logoutTab} onClick={logout}>
            log out ↗
          </button>
        </div>
      </header>

      {/* ============================================================
          MAIN — spine | scrollable map | field-notes sidebar
          (sidebar + spine collapse below 900px)
          ============================================================ */}
      <main className={styles.main}>
        <div className={styles.spine} aria-hidden />

        <div ref={scrollRef} className={styles.scrollContainer}>
          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            className={styles.svg}
          >
            <PaperDefs />

            {/* cream paper base */}
            <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} fill="#f4ead5" />

            {/* per-world watercolor wash — overshoots the band edges so the
                wobbled displacement doesn't reveal bare paper at the seams */}
            {WORLDS.map(world => (
              <rect
                key={`wash-${world.id}`}
                x="-12"
                y={world.bandY.top - 8}
                width={SVG_WIDTH + 24}
                height={world.bandY.bottom - world.bandY.top + 16}
                fill={world.washColor}
                opacity="0.42"
                filter="url(#watercolorEdge)"
              />
            ))}

            {/* extra wash splotches for painterly depth */}
            <ellipse cx="90"  cy="240"  rx="80"  ry="44" fill="#cfd9e8" opacity="0.32" filter="url(#watercolorEdge)" />
            <ellipse cx="310" cy="1420" rx="70"  ry="40" fill="#e9c2cf" opacity="0.30" filter="url(#watercolorEdge)" />
            <ellipse cx="200" cy="2380" rx="120" ry="38" fill="#cdb8dd" opacity="0.26" filter="url(#watercolorEdge)" />
            <ellipse cx="100" cy="3340" rx="80"  ry="42" fill="#e8c780" opacity="0.30" filter="url(#watercolorEdge)" />
            <ellipse cx="300" cy="4280" rx="90"  ry="44" fill="#bcd9b8" opacity="0.28" filter="url(#watercolorEdge)" />

            {/* torn-paper transitions between each adjacent pair of worlds.
                The tear fills with the lower world's wash so it bleeds up
                into the chapter above, like ripped journal pages. */}
            {WORLDS.slice(0, -1).map((lower, i) => (
              <TornEdge
                key={`tear-${lower.id}`}
                y={lower.bandY.top}
                fillColor={lower.washColor}
                seedOffset={i * 13}
              />
            ))}

            {/* per-world wallpaper motifs (mushrooms, honeycomb, crystals,
                petals, clouds) — sits above the wash, below noise/road */}
            <WorldWallpaper />

            {/* paper-fiber noise across the whole page */}
            <rect
              x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT}
              filter="url(#paperNoise)"
              opacity="0.55"
              pointerEvents="none"
            />

            {/* dot-grid notebook overlay */}
            <rect
              x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT}
              fill="url(#dotGrid)"
              opacity="0.4"
              pointerEvents="none"
            />

            {/* margin doodles */}
            <Doodles />

            {/* hand-drawn road */}
            <PencilRoad />

            {/* chapter-style world labels */}
            {WORLDS.map((world, idx) => (
              <WorldChapter key={world.id} world={world} index={idx} />
            ))}

            {/* nodes */}
            {MAP_NODES.map(node => {
              const state = deriveNodeState(node.id, currentNodeId, progressMap);
              return (
                <PaperNode
                  key={node.id}
                  node={node}
                  state={state}
                  onClick={setSelectedNode}
                  isCurrent={node.id === currentNodeId && state === NODE_STATE.AVAILABLE}
                />
              );
            })}
          </svg>
        </div>

        {/* ============================================================
            FIELD NOTES sidebar — pinned to the right like a binder pocket
            ============================================================ */}
        {menuOpen && (
          <div className={styles.drawerBackdrop} onClick={() => setMenuOpen(false)} />
        )}
        <aside
          className={`${styles.fieldNotes} ${menuOpen ? styles.fieldNotesOpen : ''}`}
          aria-label="Field notes"
        >
          <button
            className={styles.drawerClose}
            onClick={() => setMenuOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
          <div className={styles.notesHeading}>field notes</div>

          <div className={`${styles.notesCard} ${styles.travelerCard}`}>
            <span className={styles.washiPin} aria-hidden />
            <div className={styles.notesCardTitle}>traveler</div>

            <button
              type="button"
              className={styles.avatarPortraitBtn}
              onClick={() => setProfileOpen(true)}
              title="Edit avatar"
              aria-label="Edit avatar"
            >
              <span className={styles.avatarFrame} aria-hidden>
                <span className={styles.avatarWashi} aria-hidden />
                <span className={styles.avatarPortrait}>{renderAvatar(avatar)}</span>
              </span>
            </button>

            <div className={styles.avatarName}>{username}</div>
            <div className={styles.avatarHint}>✎ tap to change</div>

            <div className={styles.notesStat}>
              quests <strong>{completedCount} / {MAP_NODES.length}</strong>
            </div>
            <div className={styles.notesStat}>
              chapter <strong>{currentChapter}</strong>
            </div>
          </div>

          <div className={styles.notesCard}>
            <span className={styles.washiPin2} aria-hidden />
            <div className={styles.notesCardTitle}>my companions</div>
            <div className={styles.companionGrid}>
              {COMPANION_ORDER.map(id => {
                const c = COMPANIONS[id];
                const isOwned = ownsCompanion(id);
                const isActive = id === activeId;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.companionTile} ${isActive ? styles.companionTileActive : ''} ${!isOwned ? styles.companionTileLocked : ''}`}
                    onClick={() => handleSelectCompanion(id)}
                    disabled={!isOwned}
                    title={isOwned ? c.bondPower.name : `Defeat the boss to befriend ${c.name}`}
                  >
                    <span className={styles.companionTileIcon}>{isOwned ? c.icon : '?'}</span>
                    <span className={styles.companionTileName}>{isOwned ? c.name : '???'}</span>
                  </button>
                );
              })}
            </div>
            {companionError && <p className={styles.companionError}>{companionError}</p>}
          </div>

          {user && user.account_type !== 'parent' && !user.dragon_trial_completed && (
            <div className={styles.notesCard}>
              <span className={styles.washiPin} aria-hidden />
              <div className={styles.notesCardTitle}>dragon's trial</div>
              <div className={styles.notesCardBody}>
                <p style={{ marginTop: 0 }}>
                  <span style={{ fontSize: 24, marginRight: 4 }}>🐉</span>
                  An old dragon offers a single test — across +, −, ×, and ÷.
                  Prove your skill and the road will take you where the work is just right.
                </p>
                <p style={{
                  marginTop: 4,
                  fontFamily: 'var(--font-display)',
                  fontSize: 18,
                  color: 'var(--kraft-dark)',
                  fontStyle: 'italic',
                }}>
                  — once only, traveler
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/trial');
                    setMenuOpen(false);
                  }}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '8px 12px',
                    background: '#7d5a3f',
                    color: '#faf0d7',
                    border: 'none',
                    borderRadius: 10,
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 20,
                    cursor: 'pointer',
                    boxShadow: '2px 2px 0 rgba(61, 53, 40, 0.18)',
                  }}
                >
                  ⚔ begin the trial
                </button>
              </div>
            </div>
          )}

          <div className={styles.compassWrap}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>
              ✎ keep going, traveler
            </span>
          </div>
        </aside>
      </main>

      {/* Profile modal — avatar picker */}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      {/* ============================================================
          MODAL — index card pinned with washi tape
          ============================================================ */}
      {selectedNode && (
        <div
          className={styles.modalOverlay}
          onClick={() => setSelectedNode(null)}
          role="presentation"
        >
          <div
            className={styles.modal}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={selectedNode.label}
          >
            <span className={styles.modalWashiLeft} aria-hidden />
            <span className={styles.modalWashiRight} aria-hidden />

            <button
              className={styles.modalClose}
              onClick={() => setSelectedNode(null)}
              aria-label="Close"
              type="button"
            >
              ×
            </button>

            <div className={styles.modalIcon} aria-hidden>{selectedNode.icon}</div>

            <h2 className={styles.modalTitle}>{selectedNode.label}</h2>

            {isBossSelected && (
              <p className={styles.modalBossTag}>↯ boss battle ↯</p>
            )}

            <p className={styles.modalDesc}>
              {isBossSelected
                ? '"A fearsome dragon guards this pass. Be brave, traveler — sharpen your sums and steady your hand."'
                : '"Another duel waits along the path. Answer faster than your foe, and the road opens onward."'}
            </p>

            <p className={styles.modalSignature}>— ✎ the storyteller</p>

            <button
              className={`${styles.modalButton} ${isBossSelected ? styles.modalButtonBoss : ''}`}
              type="button"
              onClick={() => navigate(`/battle/${selectedNode.id}`)}
            >
              {isBossSelected ? '⚔ fight the dragon' : '✎ begin quest'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
