import { useNavigate } from 'react-router-dom';
import { OPERATIONS } from '../data/operations';
import styles from '../styles/LearningLair.module.css';

export function LearningLairPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/map')}>
          ← back to map
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🦉</span>
          <h1 className={styles.title}>Learning Lair</h1>
          <p className={styles.subtitle}>— pick a skill to practice</p>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.cardGrid}>
          {OPERATIONS.map(op => (
            <button
              key={op.key}
              type="button"
              className={styles.opCard}
              style={{ '--accent': op.color }}
              onClick={() => navigate(`/learning-lair/${op.key}`)}
              aria-label={`Practice ${op.label}`}
            >
              <span className={styles.opSymbol} aria-hidden>{op.symbol}</span>
              <span className={styles.opLabel}>{op.label}</span>
              <span className={styles.opBlurb}>{op.blurb}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
