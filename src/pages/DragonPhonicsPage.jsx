import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragonPhonics } from '../components/DragonPhonics';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { PHONICS_LEVELS } from '../data/phonicsWords';
import styles from '../styles/DragonPhonics.module.css';

// Dragon Phonics ("Missing Sound") lives outside the math-operation flow: the
// child picks a phonics level here, then plays a round. Quitting/finishing
// returns to this picker; the back tab steps out to the Learning Lair.
export function DragonPhonicsPage() {
  const navigate = useNavigate();
  usePlaytimeHeartbeat(true);

  const [level, setLevel] = useState(null);
  const [playing, setPlaying] = useState(false);

  if (playing && level) {
    return <DragonPhonics level={level} onComplete={() => setPlaying(false)} />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backTab} onClick={() => navigate('/learning-lair')}>
          ← back
        </button>
        <h1 className={styles.title}>
          <span className={styles.titleIcon} aria-hidden>🐲</span>
          Dragon Phonics
        </h1>
        <p className={styles.subtitle}>listen to the word, then find the missing sound</p>
      </header>

      <main className={styles.pickerMain}>
        <section className={styles.pickerSection}>
          <h2 className={styles.pickerHeading}>Pick a level</h2>
          <div className={styles.levelGrid}>
            {PHONICS_LEVELS.map((l) => (
              <button
                key={l.key}
                type="button"
                className={`${styles.levelCard} ${
                  level === l.key ? styles.levelCardActive : ''
                }`}
                onClick={() => setLevel(l.key)}
              >
                <span className={styles.levelEmoji} aria-hidden>{l.emoji}</span>
                <span className={styles.levelLabel}>{l.label}</span>
                <span className={styles.levelBlurb}>{l.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          className={styles.startBtn}
          disabled={!level}
          onClick={() => setPlaying(true)}
        >
          Start listening →
        </button>
      </main>
    </div>
  );
}
