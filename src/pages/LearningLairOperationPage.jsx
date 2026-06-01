import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { OPERATION_BY_KEY, masteryTier } from '../data/operations';
import styles from '../styles/LearningLair.module.css';

const NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);

// Tier → label/swatch, ordered weakest → strongest for the legend.
const TIERS = [
  { key: 'none',       label: 'not practiced yet', className: 'tier_none' },
  { key: 'new',        label: 'just starting',     className: 'tier_new' },
  { key: 'learning',   label: 'keep practicing',   className: 'tier_learning' },
  { key: 'practicing', label: 'getting there',     className: 'tier_practicing' },
  { key: 'strong',     label: 'almost mastered',   className: 'tier_strong' },
  { key: 'mastered',   label: 'mastered!',         className: 'tier_mastered' },
];
const TIER_LABEL = Object.fromEntries(TIERS.map(t => [t.key, t.label]));

export function LearningLairOperationPage() {
  const { operation } = useParams();
  const navigate = useNavigate();
  const op = OPERATION_BY_KEY[operation];

  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!op) return;
    let cancelled = false;
    (async () => {
      try {
        const { operations } = await api.get('/api/mastery');
        if (!cancelled) setGrid(operations[op.key] || {});
      } catch (err) {
        console.error('Failed to load mastery:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [op]);

  // Unknown operation slug — send the kid back to the lair.
  if (!op) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.washiTopStrip} />
          <button className={styles.backTab} onClick={() => navigate('/learning-lair')}>
            ← learning lair
          </button>
          <div className={styles.titleWrap}>
            <span className={styles.titleIcon} aria-hidden>🤔</span>
            <h1 className={styles.title}>Hmm…</h1>
          </div>
        </header>
        <main className={styles.main}>
          <p className={styles.emptyNote}>That skill isn’t in the lair.</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/learning-lair')}>
          ← learning lair
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} style={{ color: op.color }} aria-hidden>
            {op.symbol}
          </span>
          <h1 className={styles.title}>{op.label}</h1>
          <p className={styles.subtitle}>— how well you know each number</p>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.loadingScreen}>
            <span className={styles.loadingGlyph}>✦</span>
            <p className={styles.loadingText}>gathering your notes…</p>
          </div>
        ) : error ? (
          <p className={styles.emptyNote}>Couldn’t load your progress — try again later.</p>
        ) : (
          <>
            <div className={styles.numberGrid} style={{ '--accent': op.color }}>
              {NUMBERS.map(n => {
                const cell = grid?.[n];
                const tier = masteryTier(cell);
                const pct = cell && cell.accuracy != null
                  ? Math.round(cell.accuracy * 100)
                  : null;
                return (
                  <div
                    key={n}
                    className={`${styles.numCell} ${styles['tier_' + tier]}`}
                    title={`${op.label} with ${n}: ${TIER_LABEL[tier]}${pct != null ? ` · ${pct}%` : ''}`}
                  >
                    <span className={styles.numValue}>{n}</span>
                    <span className={styles.numMeta}>
                      {tier === 'none' ? '—' : `${pct}%`}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className={styles.legend}>
              {TIERS.map(t => (
                <span key={t.key} className={styles.legendItem}>
                  <span className={`${styles.legendSwatch} ${styles[t.className]}`} aria-hidden />
                  {t.label}
                </span>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
