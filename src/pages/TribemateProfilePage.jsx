import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { rarityMeta, dragonImage } from '../data/dragonRarity';
import { renderAvatar } from '../utils/avatar';
import { WORLDS } from '../data/mapData';
import styles from '../styles/DragonCollectionPage.module.css';

function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

function rankLabel(rank) {
  if (rank === 1) return '🥇 1st';
  if (rank === 2) return '🥈 2nd';
  if (rank === 3) return '🥉 3rd';
  return `#${rank}`;
}

// A tribemate's public profile: avatar, world/level, tribe rank, and their Dragon
// Den. Unlike the classmate page, this shows ONLY collected dragons — no locked
// egg slots for un-collected ones.
export function TribemateProfilePage() {
  const { childId } = useParams();
  const navigate = useNavigate();
  const [tribemate, setTribemate] = useState(null);
  const [owned, setOwned] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/tribes/tribemate/${childId}`)
      .then(({ tribemate, owned }) => {
        setTribemate(tribemate);
        setOwned(owned);
      })
      .catch(err => setError(err.message));
  }, [childId]);

  const world = tribemate ? worldForNode(tribemate.current_node_id) : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/tribes')}>
          ← back to tribes
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>{tribemate ? renderAvatar(tribemate.avatar) : '🐲'}</span>
          <h1 className={styles.title}>{tribemate?.username || 'Adventurer'}</h1>
          <p className={styles.subtitle}>
            {world ? `— exploring ${world.name}` : '— a fellow dragon-mathlete'}
          </p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.errorNote}>Couldn’t load this adventurer — {error}</p>}
        {!tribemate && !error && <p className={styles.loadingNote}>peeking at their dragons…</p>}

        {tribemate && owned && (
          <>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCount}>
                <span className={styles.summaryBig}>{tribemate.dragons_collected}</span>
                <span className={styles.summaryUnit}>dragons collected</span>
              </div>
              {tribemate.rank != null && (
                <div className={styles.summaryCount}>
                  <span className={styles.summaryBig}>{rankLabel(tribemate.rank)}</span>
                  <span className={styles.summaryUnit}>in tribe of {tribemate.tribe_size}</span>
                </div>
              )}
            </div>

            {owned.length === 0 ? (
              <p className={styles.emptyNote}>No dragons in the den yet.</p>
            ) : (
              <div className={styles.grid}>
                {owned.map(dragon => {
                  const meta = rarityMeta(dragon.rarity);
                  return (
                    <div
                      key={dragon.dragon_id}
                      className={styles.slot}
                      style={{ '--rarity': meta.color, '--rarity-glow': meta.glow }}
                      title={`${meta.label}${dragon.count > 1 ? ` · ×${dragon.count}` : ''}`}
                    >
                      <img
                        src={dragonImage(dragon.dragon_id)}
                        alt={`${meta.label} dragon`}
                        className={styles.slotImg}
                        loading="lazy"
                      />
                      {dragon.count > 1 && <span className={styles.countBadge}>×{dragon.count}</span>}
                      <span className={styles.rarityTag}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
