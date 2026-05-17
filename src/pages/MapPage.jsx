import { useState } from 'react';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { useAuth } from '../hooks/useAuth';
import { WorldMap } from '../components/map/WorldMap';
import { NODE_TYPE } from '../data/mapData';
import styles from '../styles/MapPage.module.css';

export function MapPage() {
  const { progressMap, currentNodeId, displayName, loading } = useNodeProgress();
  const { logout } = useAuth();
  const [selectedNode, setSelectedNode] = useState(null);

  function handleNodeClick(node) {
    setSelectedNode(node);
  }

  function handleCloseModal() {
    setSelectedNode(null);
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.loadingDragon}>🐉</span>
        <p>Loading your adventure...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🐉</span>
          <span className={styles.headerTitle}>Dragon Math</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.playerName}>⚔️ {displayName}</span>
          <button className={styles.logoutBtn} onClick={logout}>Log out</button>
        </div>
      </header>

      {/* Map */}
      <main className={styles.main}>
        <WorldMap
          progressMap={progressMap}
          currentNodeId={currentNodeId}
          onNodeClick={handleNodeClick}
        />
      </main>

      {/* Node selection modal */}
      {selectedNode && (
        <div className={styles.modalOverlay} onClick={handleCloseModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={handleCloseModal}>✕</button>
            <div className={styles.modalIcon}>{selectedNode.icon}</div>
            <h2 className={styles.modalTitle}>{selectedNode.label}</h2>
            {selectedNode.type === NODE_TYPE.BOSS && (
              <p className={styles.modalBossTag}>BOSS BATTLE</p>
            )}
            <p className={styles.modalDesc}>
              {selectedNode.type === NODE_TYPE.BOSS
                ? 'A fearsome dragon guards this pass! Defeat it to move on.'
                : 'A math duel awaits! Answer faster than your opponent to win.'}
            </p>
            <button className={styles.modalPlayBtn}>
              {selectedNode.type === NODE_TYPE.BOSS ? '⚔️ Fight!' : '▶ Play'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
