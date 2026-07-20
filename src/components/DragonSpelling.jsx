import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from '../styles/DragonSpelling.module.css';
import { DragonPrizeReveal } from './DragonPrizeReveal';
import { soundEffects } from '../utils/soundEffects';
import { speakWord, primeSpeech } from '../utils/speakWord';
import {
  pickWords,
  SPELLING_DIFFICULTY_BY_KEY,
} from '../data/spellingWords';

// How long the word stays on screen in Medium before it's hidden to type.
const FLASH_MS = 2500;

// On-screen keyboard so the device keyboard's autocomplete can't whisper the
// answer in the typing modes (Medium/Hard). Plain QWERTY rows + Backspace.
const KEYBOARD_ROWS = [
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  'zxcvbnm'.split(''),
];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const bestKey = (grade, difficulty) =>
  `dragonmath:spelling:best:${grade}:${difficulty}`;

function readBest(grade, difficulty) {
  try {
    const raw = localStorage.getItem(bestKey(grade, difficulty));
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeBest(grade, difficulty, score) {
  try {
    localStorage.setItem(bestKey(grade, difficulty), JSON.stringify(score));
  } catch {
    /* private mode / storage full — best just won't persist */
  }
}

/**
 * Dragon Spelling — hear a word, then spell it. `difficulty` decides how much
 * help is on screen (see SPELLING_DIFFICULTIES). `onComplete()` returns to the
 * grade/difficulty picker.
 */
export function DragonSpelling({ grade, difficulty, onComplete }) {
  const diff = SPELLING_DIFFICULTY_BY_KEY[difficulty] || SPELLING_DIFFICULTY_BY_KEY.medium;

  // One round = WORDS_PER_ROUND words, picked once per round.
  const [round, setRound] = useState(0);
  const words = useMemo(() => pickWords(grade), [grade, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]); // [{ word, correct }]

  // phase: 'flash' (Medium peek) | 'spell' (awaiting answer) | 'feedback' | 'done'
  const [phase, setPhase] = useState(diff.key === 'medium' ? 'flash' : 'spell');
  const [typed, setTyped] = useState('');
  const [placed, setPlaced] = useState([]); // tile ids chosen, in order (Easy)
  const [lastCorrect, setLastCorrect] = useState(false);

  const word = words[index];
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  };

  useEffect(() => primeSpeech(), []);
  useEffect(() => clearTimers, []); // cleanup on unmount

  // Easy mode: scrambled letter tiles for the current word.
  const tiles = useMemo(() => {
    if (diff.key !== 'easy' || !word) return [];
    return shuffle(word.split('').map((letter, id) => ({ id, letter })));
  }, [diff.key, word]);

  const builtFromTiles = placed
    .map((id) => tiles.find((t) => t.id === id)?.letter ?? '')
    .join('');

  // Set up each word: reset input, flash (Medium) then speak.
  useEffect(() => {
    if (!word) return;
    clearTimers();
    setTyped('');
    setPlaced([]);

    if (diff.key === 'medium') {
      setPhase('flash');
      speakWord(word);
      later(() => setPhase('spell'), FLASH_MS);
    } else {
      setPhase('spell');
      speakWord(word);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, round]);

  const submit = useCallback(
    (attempt) => {
      if (phase !== 'spell' || !word) return;
      const guess = attempt.trim().toLowerCase();
      if (!guess) return;
      const correct = guess === word.toLowerCase();

      setLastCorrect(correct);
      setResults((r) => [...r, { word, correct }]);
      if (correct) soundEffects.playCorrect();
      else soundEffects.playWrong();
      setPhase('feedback');
    },
    [phase, word],
  );

  // The feedback card now waits for the student to acknowledge, so they can
  // study the correct spelling for as long as they like before moving on.
  const advance = useCallback(() => {
    if (phase !== 'feedback') return;
    clearTimers();
    if (index + 1 >= words.length) {
      setPhase('done');
    } else {
      setIndex((i) => i + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, words.length]);

  // On-screen keyboard taps (Medium/Hard).
  const pressKey = useCallback(
    (letter) => {
      if (phase !== 'spell') return;
      if (word && typed.length >= word.length + 4) return; // gentle cap
      setTyped((t) => t + letter);
    },
    [phase, typed.length, word],
  );
  const backspace = useCallback(() => {
    if (phase !== 'spell') return;
    setTyped((t) => t.slice(0, -1));
  }, [phase]);

  // Let desktop players use their real keyboard too (no autocomplete on a
  // physical keyboard, so it's not a cheat there). Ignored in Easy/tile mode.
  useEffect(() => {
    if (diff.key === 'easy' || phase !== 'spell') return;
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit(typed);
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        pressKey(e.key.toLowerCase());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [diff.key, phase, typed, pressKey, backspace, submit]);

  const correctCount = results.filter((r) => r.correct).length;

  // ---- End-of-round bookkeeping (high score) ----
  const [best, setBest] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  useEffect(() => {
    if (phase !== 'done') return;
    const prior = readBest(grade, difficulty);
    if (prior == null || correctCount > prior) {
      writeBest(grade, difficulty, correctCount);
      setBest(correctCount);
      setIsNewBest(prior != null && correctCount > prior);
    } else {
      setBest(prior);
      setIsNewBest(false);
    }
    if (correctCount >= words.length) soundEffects.playCorrect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const playAgain = () => {
    clearTimers();
    setIndex(0);
    setResults([]);
    setRound((r) => r + 1);
  };

  // ---------------------------------------------------------------- render
  if (phase === 'done') {
    const stars = Math.round((correctCount / words.length) * 5);
    return (
      <div className={styles.page}>
        <div className={styles.endCard}>
          <div className={styles.endDragon} aria-hidden>🐲</div>
          <h2 className={styles.endTitle}>
            {correctCount === words.length ? 'Perfect spelling!' : 'Great spelling!'}
          </h2>
          <p className={styles.endScore}>
            You spelled <strong>{correctCount}</strong> of {words.length} words right.
          </p>
          <div className={styles.stars} aria-hidden>
            {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
          </div>
          <p className={styles.endBest}>
            {isNewBest ? '🏆 New best! ' : 'Best: '}
            {best} / {words.length}
          </p>

          <DragonPrizeReveal
            performance={
              correctCount / words.length >= 0.8
                ? 'high'
                : correctCount / words.length >= 0.4
                  ? 'normal'
                  : 'low'
            }
          />

          <ul className={styles.recap}>
            {results.map((r, i) => (
              <li
                key={i}
                className={r.correct ? styles.recapRight : styles.recapWrong}
              >
                <span className={styles.recapMark}>{r.correct ? '✓' : '✗'}</span>
                <span className={styles.recapWord}>{r.word}</span>
              </li>
            ))}
          </ul>

          <div className={styles.endButtons}>
            <button className={styles.primaryBtn} onClick={playAgain}>
              Play again
            </button>
            <button className={styles.ghostBtn} onClick={() => onComplete?.()}>
              Choose grade
            </button>
          </div>
        </div>
      </div>
    );
  }

  const wordNum = Math.min(index + 1, words.length);

  return (
    <div className={styles.page}>
      <header className={styles.gameHeader}>
        <button className={styles.quitBtn} onClick={() => onComplete?.()}>
          ← quit
        </button>
        <div className={styles.progressWrap}>
          <span className={styles.progressLabel}>
            Word {wordNum} of {words.length}
          </span>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${(index / words.length) * 100}%` }}
            />
          </div>
        </div>
        <span className={styles.scorePill}>
          {diff.emoji} {correctCount} ✓
        </span>
      </header>

      <main className={styles.stage}>
        <button
          type="button"
          className={styles.hearBtn}
          onClick={() => speakWord(word)}
          aria-label="Hear the word again"
        >
          <span className={styles.hearIcon} aria-hidden>🔊</span>
          Hear the word
        </button>

        {/* Medium: flash the word, then hide it. */}
        {diff.key === 'medium' && phase === 'flash' && (
          <div className={styles.flashCard}>
            <span className={styles.flashHint}>Look closely…</span>
            <span className={styles.flashWord}>{word}</span>
          </div>
        )}

        {/* Easy: a starting-letter hint + length blanks. */}
        {diff.key === 'easy' && phase !== 'feedback' && (
          <div className={styles.hintRow}>
            <span className={styles.hintChip}>
              starts with “{word[0]}” · {word.length} letters
            </span>
          </div>
        )}

        {/* ---- Answer area ---- */}
        {phase === 'feedback' ? (
          <div
            className={`${styles.feedbackCard} ${
              lastCorrect ? styles.feedbackRight : styles.feedbackWrong
            }`}
          >
            <span className={styles.feedbackMark} aria-hidden>
              {lastCorrect ? '✓' : '✗'}
            </span>
            <span className={styles.feedbackWord}>{word}</span>
            {!lastCorrect && (
              <span className={styles.feedbackYou}>
                you wrote: {(diff.key === 'easy' ? builtFromTiles : typed) || '—'}
              </span>
            )}
            <button
              type="button"
              className={styles.feedbackOkBtn}
              onClick={advance}
              autoFocus
            >
              {lastCorrect ? 'OK! 🎉' : 'Got it'}
            </button>
          </div>
        ) : diff.key === 'easy' ? (
          <div className={styles.tileArea}>
            <div className={styles.builtRow}>
              {Array.from({ length: word.length }).map((_, i) => {
                const id = placed[i];
                const letter = id != null ? tiles.find((t) => t.id === id)?.letter : '';
                return (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.slot} ${letter ? styles.slotFilled : ''}`}
                    onClick={() => letter && setPlaced((p) => p.filter((x) => x !== id))}
                    aria-label={letter ? `Remove ${letter}` : 'Empty slot'}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            <div className={styles.tileTray}>
              {tiles.map((t) =>
                placed.includes(t.id) ? null : (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.tile}
                    onClick={() => setPlaced((p) => [...p, t.id])}
                  >
                    {t.letter}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={builtFromTiles.length !== word.length}
              onClick={() => submit(builtFromTiles)}
            >
              Check it
            </button>
          </div>
        ) : (
          <div className={styles.typeArea}>
            <div
              className={`${styles.typedDisplay} ${typed ? '' : styles.typedEmpty}`}
              aria-live="polite"
              aria-label={typed ? `You typed ${typed}` : 'Tap the letters to spell the word'}
            >
              {typed || 'tap the letters…'}
              {phase === 'spell' && <span className={styles.typedCaret} aria-hidden />}
            </div>

            <div className={styles.keyboard} role="group" aria-label="Letter keyboard">
              {KEYBOARD_ROWS.map((row, ri) => (
                <div key={ri} className={styles.keyRow}>
                  {ri === KEYBOARD_ROWS.length - 1 && (
                    <button
                      type="button"
                      className={`${styles.key} ${styles.keyWide}`}
                      onClick={() => submit(typed)}
                      disabled={phase !== 'spell' || !typed.trim()}
                      aria-label="Check it"
                    >
                      ✓
                    </button>
                  )}
                  {row.map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      className={styles.key}
                      onClick={() => pressKey(letter)}
                      disabled={phase !== 'spell'}
                    >
                      {letter}
                    </button>
                  ))}
                  {ri === KEYBOARD_ROWS.length - 1 && (
                    <button
                      type="button"
                      className={`${styles.key} ${styles.keyWide}`}
                      onClick={backspace}
                      disabled={phase !== 'spell' || !typed}
                      aria-label="Backspace"
                    >
                      ⌫
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => submit(typed)}
              disabled={phase !== 'spell' || !typed.trim()}
            >
              Check it
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
