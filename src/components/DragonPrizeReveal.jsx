import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { dragonImage, rarityMeta } from '../data/dragonRarity';
import { drawDragonPrize, rollPrizeCount } from '../data/dragonPrize';
import styles from '../styles/DragonPrizeReveal.module.css';

/**
 * DragonPrizeReveal — the reward every finished game hands out.
 *
 * Draws 1–3 rarity-weighted dragons, saves them to the collection, then reveals
 * them. A dragon the player already owns shows how many they now have; a
 * first-ever catch gets the full "NEW!" celebration (ribbon, glow, sparkles).
 *
 * Self-contained block — drop it into any end-of-game modal/card. It owns its
 * own fetch → draw → save → reveal; the parent keeps its own buttons/navigation.
 *
 * @param {Object} props
 * @param {'low'|'normal'|'high'} [props.performance] - how the game went; skews
 *   how many dragons drop. Wins → 'high', losses → 'low'.
 * @param {Function} [props.onRevealed] - called once the dragons are shown.
 */
export function DragonPrizeReveal({ performance = 'normal', onRevealed }) {
  // Each entry: { key, dragon_id, name, rarity, isNew, total }
  const [prizes, setPrizes] = useState(null);
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode's double-invoke — draw & collect once.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    (async () => {
      // Draw from the live active catalog when we can; the draw falls back to
      // the legacy art range on its own if the fetch fails.
      let catalog = null;
      try {
        const res = await api.get('/api/dragons/catalog');
        catalog = res?.dragons || null;
      } catch {
        /* drawDragonPrize handles a null catalog */
      }

      const count = rollPrizeCount(performance);
      const drawn = drawDragonPrize(catalog, count);
      const dragonIds = drawn.map((d) => d.dragon_id);

      // Persist and learn which are new / how many we now own.
      let byId = {};
      try {
        const { results } = await api.post('/api/dragons/collect', { dragon_ids: dragonIds });
        for (const r of results || []) byId[r.dragon_id] = r;
      } catch (err) {
        // Best-effort: still show the dragons even if saving hiccuped. We can't
        // know for sure whether they're new, so treat them as duplicates.
        console.error('Failed to save dragon prize:', err);
      }

      if (cancelled) return;
      setPrizes(
        drawn.map((d, i) => ({
          key: `${d.dragon_id}-${i}`,
          dragon_id: d.dragon_id,
          name: d.name,
          rarity: d.rarity || 'common',
          isNew: byId[d.dragon_id]?.is_new || false,
          total: byId[d.dragon_id]?.total ?? null,
        })),
      );
      onRevealed?.();
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null; // never block the end screen on a prize hiccup

  const anyNew = prizes?.some((p) => p.isNew);

  return (
    <div className={styles.prize}>
      <p className={styles.heading}>
        <span className={styles.gift} aria-hidden>🎁</span>
        {prizes == null
          ? 'Opening your dragon prize…'
          : prizes.length === 1
            ? 'You won a dragon!'
            : `You won ${prizes.length} dragons!`}
      </p>

      {prizes == null ? (
        <div className={styles.loadingRow} aria-hidden>
          <span className={styles.eggShake}>🥚</span>
        </div>
      ) : (
        <div className={styles.cardRow}>
          {prizes.map((p, i) => (
            <PrizeCard key={p.key} prize={p} delayMs={i * 260} />
          ))}
        </div>
      )}

      {anyNew && (
        <p className={styles.newNote}>✨ New dragon added to your Den!</p>
      )}
    </div>
  );
}

function PrizeCard({ prize, delayMs }) {
  const meta = rarityMeta(prize.rarity);
  const cardClass = `${styles.card} ${prize.isNew ? styles.cardNew : ''}`;
  return (
    <div
      className={cardClass}
      style={{
        '--rarity-color': meta.color,
        '--rarity-glow': meta.glow,
        animationDelay: `${delayMs}ms`,
      }}
    >
      {prize.isNew && (
        <>
          <span className={styles.newRibbon}>NEW!</span>
          <span className={styles.sparkleA} aria-hidden>✨</span>
          <span className={styles.sparkleB} aria-hidden>✨</span>
        </>
      )}
      <div className={styles.frame}>
        <img
          className={styles.art}
          src={dragonImage(prize.dragon_id)}
          alt={prize.name || 'A dragon'}
          draggable={false}
        />
      </div>
      <span className={styles.rarityLabel} style={{ color: meta.color }}>
        {meta.label}
      </span>
      {prize.name && <span className={styles.name}>{prize.name}</span>}
      {!prize.isNew && prize.total != null && (
        <span className={styles.dupe}>Now ×{prize.total}</span>
      )}
    </div>
  );
}
