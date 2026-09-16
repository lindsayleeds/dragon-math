import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragonWordRescue } from '../components/DragonWordRescue';
import { useAuthContext } from '../contexts/AuthContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useSpellingLists } from '../hooks/useSpellingLists';
import { gradeSource, listSource, SPELLING_GRADES } from '../data/spellingWords';
import styles from '../styles/DragonWordRescue.module.css';

export function DragonWordRescuePage() {
  const navigate = useNavigate();
  const { user, isGuest } = useAuthContext();
  usePlaytimeHeartbeat(true);
  const { lists, loading } = useSpellingLists(null, { enabled: !isGuest });
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [guestScoreScope] = useState(() => crypto.randomUUID());

  const source = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'grade') return gradeSource(selected.id);
    const list = lists.find((entry) => entry.id === selected.id);
    return list ? listSource(list) : null;
  }, [selected, lists]);

  if (playing && source) {
    return (
      <DragonWordRescue
        source={source}
        playerScope={user?.id == null ? `guest:${guestScoreScope}` : `player:${user.id}`}
        persistentScores={!isGuest}
        onComplete={() => setPlaying(false)}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.pickerHeader}>
        <button type="button" className={styles.backTab} onClick={() => navigate('/learning-lair')}>← back</button>
        <div className={styles.titleScene} aria-hidden><span>🐲</span><i /><span>💧</span></div>
        <h1 className={styles.title}>Dragon Word Rescue</h1>
        <p className={styles.subtitle}>guess the letters and keep the dragon dry</p>
      </header>

      <main className={styles.pickerMain}>
        {!isGuest && (
          <section className={styles.pickerSection}>
            <h2 className={styles.pickerHeading}>My word lists</h2>
            {loading ? (
              <p className={styles.empty}>Loading your lists…</p>
            ) : lists.length === 0 ? (
              <p className={styles.empty}>No lists yet — a grown-up can add one from Dragon Spelling.</p>
            ) : (
              <div className={styles.listGrid}>
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    className={`${styles.listCard} ${selected?.kind === 'list' && selected.id === list.id ? styles.selected : ''}`}
                    onClick={() => setSelected({ kind: 'list', id: list.id })}
                  >
                    <strong>{list.name}</strong>
                    <span>{list.words.length} word{list.words.length === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className={styles.pickerSection}>
          <h2 className={styles.pickerHeading}>{isGuest ? 'Pick a grade' : 'Or pick a grade'}</h2>
          <div className={styles.gradeGrid}>
            {SPELLING_GRADES.map(({ grade, label }) => (
              <button
                key={grade}
                type="button"
                className={`${styles.gradeCard} ${selected?.kind === 'grade' && selected.id === grade ? styles.selected : ''}`}
                onClick={() => setSelected({ kind: 'grade', id: grade })}
              >
                <strong>{grade}</strong>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className={styles.howTo}>
          <span aria-hidden>✎</span>
          <p>Hear the word, then uncover it one letter at a time. You have six misses before a muddy splash.</p>
        </aside>

        <button type="button" className={styles.startBtn} disabled={!source} onClick={() => setPlaying(true)}>
          Start rescuing
        </button>
      </main>
    </div>
  );
}
