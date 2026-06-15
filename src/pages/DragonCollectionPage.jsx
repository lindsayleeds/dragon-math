import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { RARITIES, rarityMeta, dragonImage } from '../data/dragonRarity';
import styles from '../styles/DragonCollectionPage.module.css';

// The kid's "Dragon Den" — every dragon they've hatched, framed by the rarity a
// keeper has assigned it. Dragons they haven't caught yet show as mystery eggs,
// so the page reads as a collection to fill in. Rarity is only revealed once a
// dragon is actually owned (no spoilers for un-hatched dragons).
export function DragonCollectionPage() {
  const navigate = useNavigate();
  const [owned, setOwned] = useState(null);     // [{ dragon_id, count, rarity, first_acquired_at }]
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');  // 'all' | rarity key

  useEffect(() => {
    api.get('/api/dragons')
      .then(({ owned, total_dragons }) => {
        setOwned(owned);
        setTotal(total_dragons);
      })
      .catch(err => setError(err.message));
  }, []);

  const ownedById = useMemo(() => {
    const m = new Map();
    for (const d of owned || []) m.set(d.dragon_id, d);
    return m;
  }, [owned]);

  // Per-rarity tally of *owned* dragons, in rarity order, for the legend.
  const tallies = useMemo(() => {
    const counts = Object.fromEntries(RARITIES.map(r => [r.key, 0]));
    for (const d of owned || []) {
      if (counts[d.rarity] === undefined) counts[d.rarity] = 0;
      counts[d.rarity] += 1;
    }
    return counts;
  }, [owned]);

  // Slots to render. "All" shows the full 1..N gallery (locked + unlocked);
  // a rarity filter narrows to just the owned dragons of that rarity.
  const slots = useMemo(() => {
    if (filter === 'all') {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    return (owned || [])
      .filter(d => d.rarity === filter)
      .map(d => d.dragon_id);
  }, [filter, total, owned]);

  const collectedCount = owned?.length ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/map')}>
          ← back to the map
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🐉</span>
          <h1 className={styles.title}>My Dragon Den</h1>
          <p className={styles.subtitle}>— every dragon you’ve hatched</p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.errorNote}>Couldn’t load your dragons — {error}</p>}
        {!owned && !error && <p className={styles.loadingNote}>counting your dragons…</p>}

        {owned && (
          <>
            <div className={styles.summaryCard}>
              <div className={styles.summaryCount}>
                <span className={styles.summaryBig}>{collectedCount}</span>
                <span className={styles.summarySlash}>/ {total}</span>
                <span className={styles.summaryUnit}>dragons collected</span>
              </div>
              <div className={styles.legend}>
                <button
                  type="button"
                  className={`${styles.legendChip} ${filter === 'all' ? styles.legendChipOn : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                {RARITIES.map(r => (
                  <button
                    key={r.key}
                    type="button"
                    className={`${styles.legendChip} ${filter === r.key ? styles.legendChipOn : ''}`}
                    onClick={() => setFilter(r.key)}
                    style={{ '--rarity': r.color, '--rarity-glow': r.glow }}
                    title={`${r.label}: ${tallies[r.key]} collected`}
                  >
                    <span className={styles.legendDot} />
                    {r.label}
                    <span className={styles.legendTally}>{tallies[r.key]}</span>
                  </button>
                ))}
              </div>
            </div>

            {slots.length === 0 ? (
              <p className={styles.emptyNote}>
                {filter === 'all'
                  ? 'No dragons yet — hatch some eggs in the Learning Lair!'
                  : 'No dragons of this rarity yet — keep collecting!'}
              </p>
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
