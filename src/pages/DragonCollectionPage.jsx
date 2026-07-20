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
  const [owned, setOwned] = useState(null);     // [{ dragon_id, count, rarity, name, first_acquired_at }]
  const [catalog, setCatalog] = useState([]);   // [{ dragon_id, name, rarity }] — active dragons
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');  // 'all' | rarity key

  useEffect(() => {
    api.get('/api/dragons')
      .then(({ owned, catalog, total_dragons }) => {
        setOwned(owned);
        setCatalog(catalog || []);
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

  // The gallery is grouped into rarity sections, rarest → most common (RARITIES
  // is weakest→strongest so we walk it in reverse). Within a section every
  // dragon of that rarity gets a fixed, numbered slot ordered by catalog id, so
  // the collection reads like an album: owned dragons show their art and the
  // gaps show as empty numbered squares to fill in. A rarity filter narrows to
  // a single section. Undiscovered dragons are still just empty slots — no art,
  // no name — so nothing is spoiled beyond how many of each rarity exist.
  const sections = useMemo(() => {
    return RARITIES
      .slice()
      .reverse()
      .map(r => {
        const dragons = catalog
          .filter(d => d.rarity === r.key)
          .sort((a, b) => a.dragon_id - b.dragon_id)
          .map((d, i) => ({ ...d, numberInRarity: i + 1 }));
        return { rarity: r, dragons };
      })
      .filter(section => section.dragons.length > 0)
      .filter(section => filter === 'all' || section.rarity.key === filter);
  }, [catalog, filter]);

  const collectedCount = owned?.length ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/home')}>
          ⌂ home
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

            {sections.length === 0 ? (
              <p className={styles.emptyNote}>
                No dragons in the catalog yet — check back soon!
              </p>
            ) : (
              sections.map(({ rarity, dragons }) => {
                const ownedInSection = dragons.filter(d => ownedById.has(d.dragon_id)).length;
                return (
                  <section key={rarity.key} className={styles.raritySection}>
                    <div
                      className={styles.sectionHeader}
                      style={{ '--rarity': rarity.color, '--rarity-glow': rarity.glow }}
                    >
                      <span className={styles.sectionDot} aria-hidden />
                      <h2 className={styles.sectionTitle}>{rarity.label}</h2>
                      <span className={styles.sectionCount}>{ownedInSection} / {dragons.length}</span>
                    </div>
                    <div className={styles.grid}>
                      {dragons.map(d => {
                        const dragon = ownedById.get(d.dragon_id);
                        if (!dragon) {
                          return (
                            <div
                              key={d.dragon_id}
                              className={styles.slotLocked}
                              style={{ '--rarity': rarity.color, '--rarity-glow': rarity.glow }}
                              aria-label={`${rarity.label} dragon #${d.numberInRarity} — not collected yet`}
                              title={`${rarity.label} #${d.numberInRarity} — not collected yet`}
                            >
                              <span className={styles.slotNumber} aria-hidden>{d.numberInRarity}</span>
                            </div>
                          );
                        }
                        const meta = rarityMeta(dragon.rarity);
                        const name = dragon.name || `Dragon #${d.dragon_id}`;
                        return (
                          <div
                            key={d.dragon_id}
                            className={styles.slot}
                            style={{ '--rarity': meta.color, '--rarity-glow': meta.glow }}
                            title={`${name} — ${meta.label}${dragon.count > 1 ? ` · ×${dragon.count}` : ''}`}
                          >
                            <img
                              src={dragonImage(d.dragon_id)}
                              alt={name}
                              className={styles.slotImg}
                              loading="lazy"
                            />
                            {dragon.count > 1 && <span className={styles.countBadge}>×{dragon.count}</span>}
                            <span className={styles.dragonName}>{name}</span>
                            <span className={styles.rarityTag}>{meta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </>
        )}
      </main>
    </div>
  );
}
