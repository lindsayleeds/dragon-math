import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styles from '../styles/DragonPhonics.module.css';
import { DragonPrizeReveal } from './DragonPrizeReveal';
import { soundEffects } from '../utils/soundEffects';
import { speakWord, primeSpeech } from '../utils/speakWord';
import {
  PHONICS_LEVEL_BY_KEY,
  pickPhonicsWords,
  buildOptions,
  wordOf,
  answerOf,
  cueWordFor,
  curriculumKeyFor,
} from '../data/phonicsWords';
import { ELEMENT_BY_KEY } from '../data/phonicsCurriculum';

const bestKey = (level) => `dragonmath:phonics:best:${level}`;

function readBest(level) {
  try {
    const raw = localStorage.getItem(bestKey(level));
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeBest(level, score) {
  try {
    localStorage.setItem(bestKey(level), JSON.stringify(score));
  } catch {
    /* private mode / storage full — best just won't persist */
  }
}

/**
 * Dragon Phonics ("Missing Sound") — hear a word, then tap the missing sound.
 * `level` picks the phonics skill (see PHONICS_LEVELS). `onComplete()` returns
 * to the level picker.
 *
 * `onSave(attempts)` receives the round's attempts in the shape the phonics
 * progress API stores, so this game feeds the same Sound Map as the three
 * curriculum-driven games — see curriculumKeyFor() for how a blanked grapheme
 * becomes an element key, and why a few of them legitimately become nothing.
 */
export function DragonPhonics({ level, onComplete, onSave }) {
  const lvl = PHONICS_LEVEL_BY_KEY[level] || PHONICS_LEVEL_BY_KEY.vowels;

  // One round = a fresh set of words, picked once per round.
  const [round, setRound] = useState(0);
  const words = useMemo(() => pickPhonicsWords(lvl.key), [lvl.key, round]);
  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState({
    phase: 'play',
    chosen: null,
    lastCorrect: false,
    results: [],
  });
  const { phase, chosen, lastCorrect, results } = turn;

  const entry = words[index];
  const options = useMemo(
    () => (entry ? buildOptions(entry, lvl.options) : []),
    // A fresh set of choices per word per round.
    [entry, lvl.options, round], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => primeSpeech(), []);

  // Speak each new word as it comes up.
  useEffect(() => {
    if (!entry) return;
    setTurn((current) => ({ ...current, phase: 'play', chosen: null }));
    speakWord(wordOf(entry));
  }, [index, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    (option) => {
      if (!entry) return;
      const correct = option === answerOf(entry);
      setTurn((current) => {
        if (current.phase !== 'play') return current;
        return {
          phase: 'feedback',
          chosen: option,
          lastCorrect: correct,
          results: [...current.results, {
            word: wordOf(entry),
            correct,
            elementKey: curriculumKeyFor(entry, ELEMENT_BY_KEY),
            chosenKey: curriculumKeyFor(
              { g: entry.g.map((gr, i) => (i === entry.b ? option : gr)), b: entry.b },
              ELEMENT_BY_KEY,
            ),
          }],
        };
      });
    },
    [entry],
  );

  useEffect(() => {
    if (phase !== 'feedback') return;
    if (lastCorrect) soundEffects.playCorrect();
    else soundEffects.playWrong();
  }, [phase, lastCorrect]);

  const advance = useCallback(() => {
    if (phase !== 'feedback') return;
    if (index + 1 >= words.length) setTurn((current) => ({ ...current, phase: 'done' }));
    else setIndex((i) => i + 1);
  }, [phase, index, words.length]);

  const correctCount = results.filter((r) => r.correct).length;

  // ---- End-of-round bookkeeping (high score) ----
  const [best, setBest] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  useEffect(() => {
    if (phase !== 'done') return;
    const prior = readBest(lvl.key);
    if (prior == null || correctCount > prior) {
      writeBest(lvl.key, correctCount);
      setBest(correctCount);
      setIsNewBest(prior != null && correctCount > prior);
    } else {
      setBest(prior);
      setIsNewBest(false);
    }
    if (correctCount >= words.length) soundEffects.playCorrect();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished round saves ONCE. `savedFor` keys on the round number rather than
  // a boolean so "play again" saves again, while a re-render in the done phase
  // cannot post the same attempts twice.
  const savedFor = useRef(null);
  useEffect(() => {
    if (phase !== 'done' || !onSave) return;
    if (savedFor.current === round) return;
    savedFor.current = round;
    onSave(
      results
        .filter((r) => r.elementKey)
        .map((r) => ({
          element_key: r.elementKey,
          mode: 'missing-sound',
          correct: r.correct,
          chosen: r.correct ? null : r.chosenKey,
          response_ms: null,
        })),
    );
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const playAgain = () => {
    setIndex(0);
    setTurn({ phase: 'play', chosen: null, lastCorrect: false, results: [] });
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
            {correctCount === words.length ? 'Perfect ear!' : 'Great listening!'}
          </h2>
          <p className={styles.endScore}>
            You found <strong>{correctCount}</strong> of {words.length} sounds.
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
              Choose level
            </button>
          </div>
        </div>
      </div>
    );
  }

  const wordNum = Math.min(index + 1, words.length);
  const word = entry ? wordOf(entry) : '';

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
          {lvl.emoji} {correctCount} ✓
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

        {/* The word with the missing sound as a blank. In feedback the blank
            fills with the correct grapheme so the child sees the whole word. */}
        <div
          className={styles.wordRow}
          aria-label={
            phase === 'feedback'
              ? `The word is ${word}`
              : 'Tap the missing sound below'
          }
        >
          {entry.g.map((grapheme, i) => {
            if (i !== entry.b) {
              return (
                <span key={i} className={styles.graphemeChip}>
                  {grapheme}
                </span>
              );
            }
            // The blank slot.
            const showAnswer = phase === 'feedback';
            const cls = !showAnswer
              ? styles.blankSlot
              : lastCorrect
                ? `${styles.blankSlot} ${styles.blankRight}`
                : `${styles.blankSlot} ${styles.blankWrong}`;
            return (
              <span key={i} className={cls}>
                {showAnswer ? answerOf(entry) : '?'}
              </span>
            );
          })}
        </div>

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
                you tapped: {chosen || '—'}
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
        ) : (
          <div className={styles.optionRow} role="group" aria-label="Missing sound choices">
            {options.map((option) => {
              const cueWord = cueWordFor(option);
              return (
                <div key={option} className={styles.optionChoice}>
                  <button
                    type="button"
                    className={styles.optionTile}
                    onClick={() => submit(option)}
                    aria-label={`Choose ${option}, as in ${cueWord}`}
                  >
                    {option}
                  </button>
                  <button
                    type="button"
                    className={styles.optionCue}
                    onClick={() => speakWord(cueWord)}
                    aria-label={`Hear ${cueWord}, the example for ${option}`}
                  >
                    <span aria-hidden>🔊</span> as in {cueWord}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
