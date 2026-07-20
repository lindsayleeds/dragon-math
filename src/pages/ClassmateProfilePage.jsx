import { useEffect, useMemo, useState } from 'react';
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

// A classmate's public profile: avatar, world/level, class rank, and their Dragon
// Den rendered with the same gallery grid as the kid's own collection page.
export function ClassmateProfilePage() {
  const { childId } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [owned, setOwned] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/classroom/classmate/${childId}`)
      .then(({ student, owned, total_dragons }) => {
        setStudent(student);
        setOwned(owned);
        setTotal(total_dragons);
      })
      .catch(err => setError(err.message));
  }, [childId]);

  const ownedById = useMemo(() => {
    const m = new Map();
    for (const d of owned || []) m.set(d.dragon_id, d);
    return m;
  }, [owned]);

  const slots = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  const world = student ? worldForNode(student.current_node_id) : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/classroom')}>
          ← back to classroom
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>{student ? renderAvatar(student.avatar) : '🐲'}</span>
          <h1 className={styles.title}>{student?.username || 'Adventurer'}</h1>
          <p className={styles.subtitle}>
            {world ? `— exploring ${world.name}` : '— a fellow dragon-mathlete'}
          </p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.errorNote}>Couldn’t load this adventurer — {error}</p>}
        {!student && !error && <p className={styles.loadingNote}>peeking at their dragons…</p>}

        {student && owned && (
          <>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCount}>
                <span className={styles.summaryBig}>{student.dragons_collected}</span>
                <span className={styles.summarySlash}>/ {total}</span>
                <span className={styles.summaryUnit}>dragons collected</span>
              </div>
              {student.rank != null && (
                <div className={styles.summaryCount}>
                  <span className={styles.summaryBig}>{rankLabel(student.rank)}</span>
                  <span className={styles.summaryUnit}>in class of {student.class_size}</span>
                </div>
              )}
            </div>

            {slots.length === 0 ? (
              <p className={styles.emptyNote}>No dragons in the den yet.</p>
            ) : (
              <div className={styles.grid}>
                {slots.map(dragonId => {
                  const dragon = ownedById.get(dragonId);
                  if (!dragon) {
                    return (
                      <div key={dragonId} className={styles.slotLocked} aria-label="Undiscovered dragon">
                        <span className={styles.slotEgg} aria-hidden>🥚</span>
                      </div>
                    );
                  }
                  const meta = rarityMeta(dragon.rarity);
                  return (
                    <div
                      key={dragonId}
                      className={styles.slot}
                      style={{ '--rarity': meta.color, '--rarity-glow': meta.glow }}
                      title={`${meta.label}${dragon.count > 1 ? ` · ×${dragon.count}` : ''}`}
                    >
                      <img
                        src={dragonImage(dragonId)}
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
