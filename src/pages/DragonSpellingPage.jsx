import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragonSpelling } from '../components/DragonSpelling';
import { SpellingListEditor } from '../components/SpellingListEditor';
import { useAuthContext } from '../contexts/AuthContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useSpellingLists } from '../hooks/useSpellingLists';
import { api } from '../api';
import { useDialog } from '../hooks/useDialog';
import {
  SPELLING_GRADES,
  SPELLING_DIFFICULTIES,
  gradeSource,
  listSource,
} from '../data/spellingWords';
import styles from '../styles/DragonSpelling.module.css';

// Dragon Spelling lives outside the math-operation flow: the child picks where
// the words come from — one of their own lists ("Week 1", typed by them or a
// grown-up) or a built-in grade catalog — then a difficulty, then plays a round.
// Quitting/finishing returns to this picker; the back tab steps out to the
// Learning Lair.
export function DragonSpellingPage() {
  const navigate = useNavigate();
  // Guests play in a throwaway in-memory session with no rows in the database,
  // so there is nothing to load or save custom lists against — the section is
  // hidden for them rather than showing an empty state they can't fill.
  const { isGuest } = useAuthContext();
  usePlaytimeHeartbeat(true);

  const { lists, loading: listsLoading, refresh } = useSpellingLists(null, { enabled: !isGuest });

  const [selected, setSelected] = useState(null); // { kind: 'grade'|'list', id }
  const [difficulty, setDifficulty] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(null); // list object, or 'new'
  const [notice, setNotice] = useState(null);
  const { confirm, dialog } = useDialog();

  // Resolve the picker's selection into the word source the game plays from.
  const source = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === 'grade') return gradeSource(selected.id);
    const list = lists.find((l) => l.id === selected.id);
    return list ? listSource(list) : null;
  }, [selected, lists]);

  const isSelected = (kind, id) => selected?.kind === kind && selected?.id === id;

  async function handleDelete(list) {
    const ok = await confirm({
      title: `Delete “${list.name}”?`,
      message: 'It disappears from your lists. You can always add it again.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/spelling/lists/${list.id}`);
      if (isSelected('list', list.id)) setSelected(null);
      await refresh();
    } catch (err) {
      setNotice(`Could not delete: ${err.message}`);
    }
  }

  function handleSaved(saved, response) {
    setEditing(null);
    refresh();
    const failed = response?.audio?.failed || 0;
    setNotice(
      failed > 0
        ? `Saved “${saved.name}”. ${failed} word${failed === 1 ? '' : 's'} will use your device's voice.`
        : `Saved “${saved.name}” — ready to play!`,
    );
  }

  if (playing && source && difficulty) {
    return (
      <DragonSpelling
        source={source}
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
        {!isGuest && (
          <section className={styles.pickerSection}>
            <h2 className={styles.pickerHeading}>My word lists</h2>

            {listsLoading ? (
              <p className={styles.listEmpty}>Loading your lists…</p>
            ) : lists.length === 0 ? (
              <p className={styles.listEmpty}>
                No lists yet — add this week's spelling words and practice exactly those.
              </p>
            ) : (
              <div className={styles.listGrid}>
                {lists.map((l) => (
                  <div
                    key={l.id}
                    className={`${styles.listCard} ${isSelected('list', l.id) ? styles.listCardActive : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.listCardMain}
                      onClick={() => setSelected({ kind: 'list', id: l.id })}
                    >
                      <span className={styles.listCardName}>{l.name}</span>
                      <span className={styles.listCardCount}>
                        {l.words.length} word{l.words.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    <div className={styles.listCardActions}>
                      <button type="button" className={styles.listCardLink} onClick={() => setEditing(l)}>
                        edit
                      </button>
                      <button type="button" className={styles.listCardLink} onClick={() => handleDelete(l)}>
                        delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className={styles.newListBtn} onClick={() => setEditing('new')}>
              ＋ New word list
            </button>
            {notice && <p className={styles.listNotice}>{notice}</p>}
          </section>
        )}

        <section className={styles.pickerSection}>
          <h2 className={styles.pickerHeading}>Or pick a grade</h2>
          <div className={styles.gradeGrid}>
            {SPELLING_GRADES.map((g) => (
              <button
                key={g.grade}
                type="button"
                className={`${styles.gradeCard} ${
                  isSelected('grade', g.grade) ? styles.gradeCardActive : ''
                }`}
                onClick={() => setSelected({ kind: 'grade', id: g.grade })}
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
          disabled={!source || !difficulty}
          onClick={() => setPlaying(true)}
        >
          Start spelling →
        </button>
      </main>

      {editing && (
        <SpellingListEditor
          list={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {dialog}
    </div>
  );
}
