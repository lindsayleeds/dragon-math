import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from '../styles/DragonWordRescue.module.css';
import { DragonPrizeReveal } from './DragonPrizeReveal';
import { soundEffects } from '../utils/soundEffects';
import { primeSpeech, speakWord } from '../utils/speakWord';
import { audioUrlsFor, drawRound } from '../data/spellingWords';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const MAX_MISSES = 6;

const bestKey = (playerScope, source, roundSize) => {
  const revision = source.kind === 'list'
    ? source.revision || source.words.join(',')
    : 'catalog';
  return `dragonmath:word-rescue:best:${playerScope}:${source.key}:${roundSize}:${revision}`;
};

function readBest(storage, key) {
  try {
    const value = storage.getItem(key);
    return value == null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

function writeBest(storage, key, score) {
  try {
    storage.setItem(key, JSON.stringify(score));
  } catch {
    /* A best score is optional when storage is unavailable. */
  }
}

/**
 * A wholesome letter-guessing spelling game. Instead of drawing a gallows,
 * misses move a dragon across paper stepping stones toward a muddy puddle.
 */
export function DragonWordRescue({ source, playerScope = 'guest', persistentScores = false, onComplete }) {
  const [round, setRound] = useState(0);
  const words = useMemo(() => drawRound(source), [source, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [guessed, setGuessed] = useState([]);
  const [phase, setPhase] = useState('play'); // play | feedback | done
  const [results, setResults] = useState([]); // [{ word, rescued, misses }]

  const word = words[index] || '';
  const guessedSet = useMemo(() => new Set(guessed), [guessed]);
  const wrongLetters = guessed.filter((letter) => !word.includes(letter));
  const misses = wrongLetters.length;
  const rescuedCount = results.filter((result) => result.rescued).length;
  const lastResult = results[results.length - 1];

  const say = useCallback(
    (value) => speakWord(value, audioUrlsFor(source, value)),
    [source],
  );

  useEffect(() => primeSpeech(), []);

  useEffect(() => {
    if (!word) return;
    say(word);
  }, [index, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishWord = useCallback((nextGuessed) => {
    const nextSet = new Set(nextGuessed);
    const nextMisses = nextGuessed.filter((letter) => !word.includes(letter)).length;
    const isSolved = word.split('').every((letter) => nextSet.has(letter));
    const isFinished = isSolved || nextMisses >= MAX_MISSES;
    if (!isFinished) return;

    setResults((current) => [
      ...current,
      { word, rescued: isSolved, misses: nextMisses },
    ]);
    setPhase(isSolved ? 'feedback' : 'splash');
    if (isSolved) soundEffects.playCorrect();
  }, [word]);

  useEffect(() => {
    if (phase !== 'splash') return undefined;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setPhase('feedback'), reducedMotion ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const guessLetter = useCallback((letter) => {
    if (phase !== 'play' || guessedSet.has(letter) || !ALPHABET.includes(letter)) return;
    const nextGuessed = [...guessed, letter];
    setGuessed(nextGuessed);
    if (!word.includes(letter)) soundEffects.playWrong();
    finishWord(nextGuessed);
  }, [phase, guessed, guessedSet, word, finishWord]);

  useEffect(() => {
    if (phase !== 'play') return undefined;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const letter = event.key.toLowerCase();
      if (!ALPHABET.includes(letter)) return;
      event.preventDefault();
      guessLetter(letter);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, guessLetter]);

  const [best, setBest] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const finishRound = () => {
    const storage = persistentScores ? localStorage : sessionStorage;
    const key = bestKey(playerScope, source, words.length);
    const prior = readBest(storage, key);
    if (prior == null || rescuedCount > prior) {
      writeBest(storage, key, rescuedCount);
      setBest(rescuedCount);
      setIsNewBest(prior != null && rescuedCount > prior);
    } else {
      setBest(prior);
      setIsNewBest(false);
    }
    setPhase('done');
  };

  const advance = () => {
    if (phase !== 'feedback') return;
    if (index + 1 >= words.length) {
      finishRound();
    } else {
      setGuessed([]);
      setPhase('play');
      setIndex((current) => current + 1);
    }
  };

  const playAgain = () => {
    setIndex(0);
    setGuessed([]);
    setResults([]);
    setPhase('play');
    setRound((current) => current + 1);
  };

  if (phase === 'done') {
    const stars = Math.round((rescuedCount / words.length) * 5);
    return (
      <div className={styles.page}>
        <main className={styles.endCard}>
          <div className={styles.endDragon} aria-hidden>🐲</div>
          <h1 className={styles.endTitle}>
            {rescuedCount === words.length ? 'Every dragon stayed dry!' : 'Rescue round complete!'}
          </h1>
          <p className={styles.endScore}>
            You rescued <strong>{rescuedCount}</strong> of {words.length} words.
          </p>
          <div className={styles.stars} aria-label={`${stars} of 5 stars`}>
            {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
          </div>
          <p className={styles.endBest}>
            {isNewBest ? '🏆 New best! ' : 'Best: '}{best} / {words.length}
          </p>

          <DragonPrizeReveal
            performance={rescuedCount / words.length >= 0.8 ? 'high' : rescuedCount / words.length >= 0.4 ? 'normal' : 'low'}
          />

          <ul className={styles.recap} aria-label="Words in this round">
            {results.map((result) => (
              <li key={result.word} className={result.rescued ? styles.recapRight : styles.recapMissed}>
                <span aria-hidden>{result.rescued ? '✓' : '💧'}</span>
                <span>{result.word}</span>
              </li>
            ))}
          </ul>

          <div className={styles.endButtons}>
            <button type="button" className={styles.primaryBtn} onClick={playAgain}>Play again</button>
            <button type="button" className={styles.ghostBtn} onClick={() => onComplete?.()}>Choose words</button>
          </div>
        </main>
      </div>
    );
  }

  const wordNumber = Math.min(index + 1, words.length);
  const lastGuess = guessed[guessed.length - 1];
  const liveStatus = phase === 'splash'
    ? 'Six misses. Splash!'
    : phase === 'feedback'
      ? lastResult?.rescued
        ? `Word rescued. The word is ${word}. ${misses} ${misses === 1 ? 'miss' : 'misses'}.`
        : `Rescue missed. The word is ${word}. Wrong letters: ${wrongLetters.join(', ')}.`
      : lastGuess
        ? `${lastGuess.toUpperCase()} is ${word.includes(lastGuess) ? 'in' : 'not in'} the word. ${MAX_MISSES - misses} misses remaining.${wrongLetters.length ? ` Wrong letters: ${wrongLetters.join(', ')}.` : ''}`
        : '';
  const splashFailed = (phase === 'splash' || phase === 'feedback') && lastResult && !lastResult.rescued;

  return (
    <div className={styles.page}>
      <p className={styles.liveStatus} role="status" aria-live="polite" aria-atomic="true">{liveStatus}</p>
      <header className={styles.gameHeader}>
        <button type="button" className={styles.quitBtn} onClick={() => onComplete?.()}>← quit</button>
        <div className={styles.progressWrap}>
          <span className={styles.progressLabel}>{source.label} · word {wordNumber} of {words.length}</span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${(index / words.length) * 100}%` }} />
          </div>
        </div>
        <span className={styles.scorePill}>🐲 {rescuedCount} ✓</span>
      </header>

      <main className={styles.stage}>
        <div className={`${styles.scene} ${phase === 'splash' ? styles.sceneSplashing : ''} ${splashFailed && phase === 'feedback' ? styles.sceneMuddy : ''}`} aria-label={`${MAX_MISSES - misses} safe guesses left`}>
          <div className={styles.skyDoodle} aria-hidden>⌁ ⌁ ⌁</div>
          <div className={styles.dragonTrack} aria-hidden>
            <span
              className={`${styles.dragon} ${phase === 'splash' ? styles.dragonSplashing : ''} ${splashFailed && phase === 'feedback' ? styles.dragonMuddy : ''}`}
              style={{
                left: `calc(${(misses / MAX_MISSES) * 100}% - ${(misses / MAX_MISSES) * 47}px)`,
                '--tilt': `${misses - 2}deg`,
              }}
            >
              🐲
            </span>
            {Array.from({ length: MAX_MISSES }, (_, position) => (
              <span
                key={position}
                className={`${styles.stone} ${position < misses ? styles.stoneSplashed : ''}`}
                style={{ left: `calc(${(position / MAX_MISSES) * 100}% - ${(position / MAX_MISSES) * 40}px)` }}
              />
            ))}
            <span className={styles.puddle}>〰</span>
            {splashFailed && (
              <span className={`${styles.splash} ${phase === 'feedback' ? styles.splashSettled : ''}`}>
                <i className={styles.splashBack} />
                <i className={styles.splashFan} />
                <i className={styles.splashMud} />
                <i className={styles.splashRing} />
              </span>
            )}
          </div>
          <p className={styles.missMessage}>
            {phase === 'splash'
              ? 'Splash! Water and mud fly into the air!'
              : phase === 'feedback'
              ? lastResult?.rescued ? 'Dry scales! You found the word.' : 'Splash! The word is ready to learn.'
              : `${MAX_MISSES - misses} ${MAX_MISSES - misses === 1 ? 'guess' : 'guesses'} before the puddle`}
          </p>
        </div>

        <button type="button" className={styles.hearBtn} onClick={() => say(word)} aria-label="Hear the word again">
          <span aria-hidden>🔊</span> Hear the word
        </button>

        <p className={styles.instruction}>Choose the letters you hear in the word.</p>

        <div className={styles.wordSlots} aria-label={phase === 'feedback' ? `The word is ${word}` : 'Word to rescue'}>
          {word.split('').map((letter, position) => {
            const visible = phase === 'feedback' || guessedSet.has(letter);
            return (
              <span key={`${letter}-${position}`} className={`${styles.letterSlot} ${visible ? styles.letterVisible : ''}`}>
                {visible ? letter : ''}
              </span>
            );
          })}
        </div>

        {wrongLetters.length > 0 && (
          <p className={styles.wrongLetters}>Not in this word: <strong>{wrongLetters.join(' ')}</strong></p>
        )}

        {phase === 'feedback' ? (
          <button type="button" className={styles.primaryBtn} onClick={advance} autoFocus>
            {lastResult?.rescued ? 'Next rescue 🎉' : 'Try the next word'}
          </button>
        ) : phase === 'play' ? (
          <div className={styles.keyboard} role="group" aria-label="Letter keyboard">
            {ALPHABET.map((letter) => {
              const used = guessedSet.has(letter);
              const isRight = used && word.includes(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  className={`${styles.key} ${isRight ? styles.keyRight : ''} ${used && !isRight ? styles.keyWrong : ''}`}
                  disabled={used}
                  onClick={() => guessLetter(letter)}
                  aria-label={used ? `${letter}, already guessed` : letter}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        ) : <div className={styles.impactPause} aria-hidden />}
      </main>
    </div>
  );
}
