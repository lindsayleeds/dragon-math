import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragonSpelling } from '../components/DragonSpelling';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import {
  SPELLING_GRADES,
  SPELLING_DIFFICULTIES,
} from '../data/spellingWords';
import styles from '../styles/DragonSpelling.module.css';

// Dragon Spelling lives outside the math-operation flow: the child picks a
// grade and a difficulty here, then plays a round. Quitting/finishing returns
// to this picker; the back tab steps out to the Learning Lair.
export function DragonSpellingPage() {
  const navigate = useNavigate();
  usePlaytimeHeartbeat(true);

  const [grade, setGrade] = useState(null);
  const [difficulty, setDifficulty] = useState(null);
  const [playing, setPlaying] = useState(false);

  if (playing && grade && difficulty) {
    return (
      <DragonSpelling
        grade={grade}
        difficulty={difficulty}
        onComplete={() => setPlaying(false)}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backTab} onClick={() => navigate('/learning-lair')}>
          ← back
        </button>
        <h1 className={styles.title}>
          <span className={styles.titleIcon} aria-hidden>🐲</span>
          Dragon Spelling
        </h1>
        <p className={styles.subtitle}>listen to the word, then spell it</p>
      </header>

      <main className={styles.pickerMain}>
        <section className={styles.pickerSection}>
          <h2 className={styles.pickerHeading}>Pick a grade</h2>
          <div className={styles.gradeGrid}>
            {SPELLING_GRADES.map((g) => (
              <button
                key={g.grade}
                type="button"
                className={`${styles.gradeCard} ${
                  grade === g.grade ? styles.gradeCardActive : ''
                }`}
                onClick={() => setGrade(g.grade)}
              >
                <span className={styles.gradeNum}>{g.grade}</span>
                <span className={styles.gradeSub}>{g.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.pickerSection}>
          <h2 className={styles.pickerHeading}>Pick a difficulty</h2>
          <div className={styles.diffGrid}>
            {SPELLING_DIFFICULTIES.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`${styles.diffCard} ${
                  difficulty === d.key ? styles.diffCardActive : ''
                }`}
                onClick={() => setDifficulty(d.key)}
              >
                <span className={styles.diffEmoji} aria-hidden>{d.emoji}</span>
                <span className={styles.diffLabel}>{d.label}</span>
                <span className={styles.diffBlurb}>{d.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          className={styles.startBtn}
          disabled={!grade || !difficulty}
          onClick={() => setPlaying(true)}
        >
          Start spelling →
        </button>
      </main>
    </div>
  );
}
