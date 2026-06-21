import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { MAP_NODES, WORLDS } from '../data/mapData';
import { deriveNodeState, NODE_STATE } from '../utils/nodeHelpers';
import { ProfileModal } from '../components/profile/ProfileModal';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/HomePage.module.css';

const CHAPTER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];

function worldForNodeId(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

// The hub a kid lands on after logging in. One featured "Adventure Map" card
// (with live quest progress) plus a grid of doorways into the rest of the game.
export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { logout } = useAuth();
  const { progressMap, currentNodeId, username, loading } = useNodeProgress();
  const [profileOpen, setProfileOpen] = useState(false);

  usePlaytimeHeartbeat(true);

  const avatar = user?.avatar || '⚔️';

  const completedCount = useMemo(
    () =>
      MAP_NODES.filter(
        n => deriveNodeState(n.id, currentNodeId, progressMap) === NODE_STATE.COMPLETED
      ).length,
    [currentNodeId, progressMap]
  );

  const currentWorld = currentNodeId ? worldForNodeId(currentNodeId) : null;
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

  // The smaller doorways below the featured map card.
  const tiles = [
    {
      key: 'learning-lair',
      icon: '🦉',
      title: 'Learning Lair',
      blurb: 'practice +, −, ×, and ÷',
      accent: 'var(--sage)',
      onClick: () => navigate('/learning-lair'),
    },
    {
      key: 'profile',
      icon: renderAvatar(avatar),
      title: 'My Profile',
      blurb: 'avatar & playtime',
      accent: 'var(--rose)',
      onClick: () => setProfileOpen(true),
    },
    {
      key: 'classroom',
      icon: '🏫',
      title: 'Classroom',
      blurb: 'classmates & their dragons',
      accent: 'var(--sky)',
      onClick: () => navigate('/classroom'),
    },
    {
      key: 'tribes',
      icon: '🏕️',
      title: 'Tribes',
      blurb: 'team up with friends',
      accent: 'var(--lavender)',
      onClick: () => navigate('/tribes'),
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />

        <div className={styles.headerLeft}>
          <div className={styles.brandRow}>
            <span className={styles.brandDragon} aria-hidden>🐉</span>
            <span className={styles.brandTitleWrap}>
              <span className={styles.brandTitle}>My Dragon Math</span>
            </span>
          </div>
          <span className={styles.brandSubtitle}>
            — welcome back, {username || 'traveler'}
          </span>
        </div>

        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => setProfileOpen(true)}
            aria-label="Open your profile"
            title="Your profile"
          >
            <span className={styles.avatarPortrait}>{renderAvatar(avatar)}</span>
          </button>
          <button className={styles.logoutTab} onClick={logout}>
            log out ↗
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <p className={styles.prompt}>✎ where to today, traveler?</p>

        {/* Featured doorway — the Adventure Map, with live quest progress. */}
        <button
          type="button"
          className={styles.featured}
          onClick={() => navigate('/map')}
          aria-label="Open the Adventure Map"
        >
          <span className={styles.featuredWashiLeft} aria-hidden />
          <span className={styles.featuredWashiRight} aria-hidden />
          <span className={styles.featuredIcon} aria-hidden>🗺️</span>
          <span className={styles.featuredBody}>
            <span className={styles.featuredTitle}>Adventure Map</span>
            <span className={styles.featuredBlurb}>
              continue your hand-drawn journey
            </span>
            <span className={styles.featuredStats}>
              <span className={styles.featuredStat}>
                {completedCount} / {MAP_NODES.length} quests
              </span>
              <span className={styles.featuredDot} aria-hidden>·</span>
              <span className={styles.featuredStat}>chapter {currentChapter}</span>
            </span>
          </span>
          <span className={styles.featuredArrow} aria-hidden>→</span>
        </button>

        <div className={styles.grid}>
          {tiles.map(tile => (
            <button
              key={tile.key}
              type="button"
              className={styles.tile}
              style={{ '--accent': tile.accent }}
              onClick={tile.onClick}
              aria-label={tile.title}
            >
              <span className={styles.tilePin} aria-hidden />
              <span className={styles.tileIcon} aria-hidden>{tile.icon}</span>
              <span className={styles.tileTitle}>{tile.title}</span>
              <span className={styles.tileBlurb}>{tile.blurb}</span>
            </button>
          ))}
        </div>
      </main>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
