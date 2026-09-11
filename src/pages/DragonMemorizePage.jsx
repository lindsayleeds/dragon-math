import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { soundEffects } from '../utils/soundEffects';
import {
  firstMemoryLetter,
  hiddenWordIndexes,
  normalizeMemoryWord,
  passageSegments,
  passageWords,
  shuffledTiles,
  splitPassage,
} from '../utils/memoryPassage';
import styles from '../styles/DragonMemorize.module.css';

const DIFFICULTIES = [
  { key: 'easy', label: 'Easy', icon: '🌱', help: 'Fill a few missing words from a word bank.' },
  { key: 'medium', label: 'Medium', icon: '🌟', help: 'Put every word back in the right order.' },
  { key: 'hard', label: 'Hard', icon: '🐉', help: 'Press the first letter of each word from memory.' },
];
const MASTERY = ['Not completed', 'Easy complete', 'Medium complete', 'Hard complete'];
const LEVEL_NUMBER = { easy: 1, medium: 2, hard: 3 };
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

function speakPassage(text) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = .82;
  synth.speak(utterance);
}

export function DragonMemorizePage() {
  const navigate = useNavigate();
  const [passages, setPassages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [difficulty, setDifficulty] = useState(null);
  const [phase, setPhase] = useState('pick');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  usePlaytimeHeartbeat(true);

  useEffect(() => {
    api.get('/api/memory-passages')
      .then(data => setPassages(data.passages || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [phase]);

  function choosePassage(passage) {
    setSelected(passage);
    setDifficulty(null);
    setPhase('level');
  }

  async function refreshPassages(invalidPassageId) {
    setPassages(current => current.filter(passage => passage.id !== invalidPassageId));
    try {
      const data = await api.get('/api/memory-passages');
      setPassages(data.passages || []);
      setError(null);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  function goBack() {
    if (phase === 'pick') navigate('/learning-lair');
    else if (phase === 'level') { setSelected(null); setPhase('pick'); }
    else if (phase === 'study') setPhase('level');
    else if (phase === 'practice') setPhase('study');
    else { setSelected(null); setDifficulty(null); setPhase('pick'); }
  }

  function finishPassage(completedPassage) {
    setPassages(current => current.map(passage => passage.id === selected.id
      ? { ...passage, ...completedPassage }
      : passage));
    setSelected(current => ({ ...current, ...completedPassage }));
    setPhase('done');
  }

  function returnToPassages() {
    setSelected(null);
    setDifficulty(null);
    setPhase('pick');
  }

  return (
    <div className={styles.page}>
      <button className={styles.backTab} onClick={goBack}>← back</button>
      <header className={styles.header}>
        <span className={styles.heroDragon} aria-hidden>🐲</span>
        <div>
          <h1>Dragon Memorize</h1>
          <p>Learn each line until the whole passage is yours.</p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.error}>{error}</p>}
        {phase === 'pick' && (
          <section>
            <h2>My passages</h2>
            {loading ? <p>Opening your passage book…</p> : passages.length === 0 ? (
              <div className={styles.emptyBook}>
                <span aria-hidden>📖</span>
                <h3>Your passage book is ready</h3>
                <p>Ask a grown-up to add a verse, poem, quotation, speech, or definition.</p>
              </div>
            ) : (
              <div className={styles.passageGrid}>
                {passages.map(passage => (
                  <button className={styles.passageCard} key={passage.id} onClick={() => choosePassage(passage)}>
                    <span className={styles.category}>{passage.category}</span>
                    <strong>{passage.title}</strong>
                    <span>{passage.body}</span>
                    <small>{MASTERY[Math.min(Number(passage.mastery_level) || 0, 3)]}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {phase === 'level' && selected && (
          <section className={styles.levelPage}>
            <p className={styles.currentTitle}>{selected.title}</p>
            <h2>Choose your challenge</h2>
            <div className={styles.levelGrid}>
              {DIFFICULTIES.map(level => (
                <button key={level.key} className={styles.levelCard} onClick={() => { setDifficulty(level.key); setPhase('study'); }}>
                  <span aria-hidden>{level.icon}</span>
                  <strong>{level.label}</strong>
                  <small>{level.help}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {phase === 'study' && selected && (
          <section className={styles.studyPage}>
            <div className={styles.ribbon}>Study first</div>
            <h2>{selected.title}</h2>
            <blockquote>{selected.body}</blockquote>
            <div className={styles.studyActions}>
              <button className={styles.secondaryButton} onClick={() => speakPassage(selected.body)}>🔊 Hear it</button>
              <button className={styles.primaryButton} onClick={() => setPhase('practice')}>Hide the words</button>
            </div>
          </section>
        )}

        {phase === 'practice' && selected && (
          <MemoryPractice
            key={`${selected.id}:${difficulty}`}
            passage={selected}
            difficulty={difficulty}
            onComplete={finishPassage}
            onReturnToPassages={returnToPassages}
            onStale={refreshPassages}
          />
        )}

        {phase === 'done' && selected && (
          <section className={styles.donePage}>
            <span className={styles.doneDragon} aria-hidden>🐉</span>
            <h2>Passage remembered!</h2>
            <p>You completed <strong>{selected.title}</strong> on {difficulty}.</p>
            <button className={styles.primaryButton} onClick={() => setPhase('level')}>Try another level</button>
            <button className={styles.secondaryButton} onClick={() => { setSelected(null); setPhase('pick'); }}>My passages</button>
          </section>
        )}
      </main>
    </div>
  );
}

function MemoryPractice({ passage, difficulty, onComplete, onReturnToPassages, onStale }) {
  const activeRef = useRef(true);
  const sentences = useMemo(() => splitPassage(passage.body), [passage.body]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [revealed, setRevealed] = useState([]);
  const [usedTiles, setUsedTiles] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [hardIndex, setHardIndex] = useState(0);
  const [sentenceDone, setSentenceDone] = useState(false);
  const [message, setMessage] = useState('');
  const [savingProgress, setSavingProgress] = useState(false);
  const [recoveryKind, setRecoveryKind] = useState(null);
  const [recoveryRefreshFailed, setRecoveryRefreshFailed] = useState(false);

  const sentence = sentences[sentenceIndex] || '';
  const words = useMemo(() => passageWords(sentence), [sentence]);
  const segments = useMemo(() => passageSegments(sentence), [sentence]);
  const hidden = useMemo(() => hiddenWordIndexes(words, sentenceIndex), [words, sentenceIndex]);
  const easyTiles = useMemo(() => shuffledTiles(hidden.map(index => words[index])), [hidden, words]);
  const mediumTiles = useMemo(() => shuffledTiles(words), [words]);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const hardLetter = useCallback((letter) => {
    if (difficulty !== 'hard' || sentenceDone || !words[hardIndex]) return;
    if (normalizeMemoryWord(letter) === firstMemoryLetter(words[hardIndex])) {
      const next = hardIndex + 1;
      setHardIndex(next);
      setMessage('');
      if (next >= words.length) {
        setSentenceDone(true);
        soundEffects.playCorrect();
      }
    } else {
      setMessage('Try the first letter of the next word.');
      soundEffects.playWrong();
    }
  }, [difficulty, hardIndex, sentenceDone, words]);

  useEffect(() => {
    if (difficulty !== 'hard') return undefined;
    const onKeyDown = event => {
      if (/^[a-zA-Z0-9]$/.test(event.key)) {
        event.preventDefault();
        hardLetter(event.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [difficulty, hardLetter]);

  function pickEasy(tile) {
    if (sentenceDone || usedTiles.includes(tile.id)) return;
    const expected = hidden.find(index => !revealed.includes(index));
    if (normalizeMemoryWord(tile.word) === normalizeMemoryWord(words[expected])) {
      const nextRevealed = [...revealed, expected];
      setRevealed(nextRevealed);
      setUsedTiles([...usedTiles, tile.id]);
      setMessage('');
      soundEffects.playCorrect();
      if (nextRevealed.length === hidden.length) setSentenceDone(true);
    } else {
      setMessage('That word belongs in a different blank.');
      soundEffects.playWrong();
    }
  }

  function pickMedium(tile) {
    if (sentenceDone || chosen.includes(tile.id)) return;
    const next = [...chosen, tile.id];
    setChosen(next);
    setMessage('');
    if (next.length === words.length) {
      const built = next.map(id => mediumTiles.find(candidate => candidate.id === id)?.word);
      const correct = built.every((word, index) => normalizeMemoryWord(word) === normalizeMemoryWord(words[index]));
      if (correct) {
        setSentenceDone(true);
        soundEffects.playCorrect();
      } else {
        setMessage('Almost—check the order, then try again.');
        soundEffects.playWrong();
      }
    }
  }

  async function advance() {
    if (sentenceIndex + 1 < sentences.length) {
      setRevealed([]);
      setUsedTiles([]);
      setChosen([]);
      setHardIndex(0);
      setSentenceDone(false);
      setMessage('');
      setSentenceIndex(index => index + 1);
      return;
    }
    if (savingProgress) return;
    setSavingProgress(true);
    setMessage('');
    try {
      const result = await api.post(`/api/memory-passages/${passage.id}/progress`, {
        difficulty,
        body: passage.body,
        updated_at: passage.updated_at,
      });
      if (activeRef.current) {
        onComplete(result?.passage || { mastery_level: LEVEL_NUMBER[difficulty] || 0 });
      }
    } catch (err) {
      if (!activeRef.current) return;
      if (err.code === 'passage_changed' || err.status === 404) {
        const kind = err.status === 404 ? 'deleted' : 'changed';
        const recoveryMessage = kind === 'deleted'
          ? 'This passage is no longer available. Return to My passages to choose another one.'
          : 'This passage changed while you practiced. Return to My passages to open the latest version.';
        setRecoveryKind(kind);
        setMessage(recoveryMessage);
        const refreshed = await onStale(passage.id);
        if (activeRef.current) {
          setRecoveryRefreshFailed(!refreshed);
          setMessage(refreshed
            ? recoveryMessage
            : `${recoveryMessage} We couldn't refresh your passage book. Try again.`);
          setSavingProgress(false);
        }
        return;
      }
      setMessage("We couldn't save your progress yet. Check your connection, then try again.");
      setSavingProgress(false);
    }
  }

  async function retryRecovery() {
    if (savingProgress) return;
    setSavingProgress(true);
    const refreshed = await onStale(passage.id);
    if (!activeRef.current) return;
    setRecoveryRefreshFailed(!refreshed);
    setMessage(refreshed
      ? recoveryKind === 'deleted'
        ? 'This passage is no longer available. Return to My passages to choose another one.'
        : 'This passage changed while you practiced. Return to My passages to open the latest version.'
      : "We still couldn't refresh your passage book. Check your connection, then try again.");
    setSavingProgress(false);
  }

  const chosenWords = chosen.map(id => mediumTiles.find(tile => tile.id === id)?.word).filter(Boolean);

  function renderSegments(wordForIndex, visibleSegments = segments) {
    return visibleSegments.map((segment, index) => segment.type === 'separator'
      ? <span key={`separator:${index}`}>{segment.value}</span>
      : <span key={`word:${segment.wordIndex}`}>{wordForIndex(segment)}</span>);
  }

  const nextUnchosenSegment = segments.findIndex(segment => segment.type === 'word' && segment.wordIndex === chosenWords.length);
  const chosenSegments = nextUnchosenSegment === -1 ? segments : segments.slice(0, nextUnchosenSegment);

  return (
    <section className={styles.practicePage}>
      <div className={styles.progress}>Sentence {sentenceIndex + 1} of {sentences.length}</div>
      <h2>{passage.title}</h2>

      {difficulty === 'easy' && (
        <>
          <div className={styles.wordLine} aria-label="Sentence with missing words">
            {renderSegments(segment => hidden.includes(segment.wordIndex) && !revealed.includes(segment.wordIndex)
              ? <span className={styles.blank}>{'_'.repeat(Math.min(segment.value.length, 10))}</span>
              : segment.value)}
          </div>
          <p className={styles.instruction}>Choose the words in blank order.</p>
          <div className={styles.tileTray}>
            {easyTiles.map(tile => <button key={tile.id} disabled={usedTiles.includes(tile.id)} onClick={() => pickEasy(tile)}>{tile.word}</button>)}
          </div>
        </>
      )}

      {difficulty === 'medium' && (
        <>
          <div className={styles.buildLine}>{chosenWords.length > 0
            ? renderSegments(segment => chosenWords[segment.wordIndex] || '', chosenSegments)
            : 'Build the sentence here…'}</div>
          <div className={styles.tileTray}>
            {mediumTiles.map(tile => <button key={tile.id} disabled={chosen.includes(tile.id)} onClick={() => pickMedium(tile)}>{tile.word}</button>)}
          </div>
          <div className={styles.smallActions}>
            <button disabled={chosen.length === 0 || sentenceDone} onClick={() => setChosen(ids => ids.slice(0, -1))}>Undo last</button>
            {message && chosen.length === words.length && <button onClick={() => { setChosen([]); setMessage(''); }}>Try again</button>}
          </div>
        </>
      )}

      {difficulty === 'hard' && (
        <>
          <p className={styles.instruction}>Press the first letter of each word.</p>
          <div className={styles.hardLine} aria-live="polite">
            {renderSegments(segment => (
              <span className={segment.wordIndex === hardIndex ? styles.currentBlank : ''}>
                {segment.wordIndex < hardIndex ? segment.value : '_'.repeat(Math.min(segment.value.length, 10))}
              </span>
            ))}
          </div>
          <div className={styles.keyboard} aria-label="Letter keyboard">
            {KEYS.map(letter => <button key={letter} onClick={() => hardLetter(letter)}>{letter}</button>)}
          </div>
        </>
      )}

      {message && <p className={styles.feedback}>{message}</p>}
      {sentenceDone && (
        <div className={styles.successRow}>
          <span>🌿 Sentence remembered!</span>
          <button
            className={styles.primaryButton}
            disabled={savingProgress}
            onClick={recoveryKind ? recoveryRefreshFailed ? retryRecovery : onReturnToPassages : advance}
          >
            {recoveryKind
              ? savingProgress ? 'Refreshing…' : recoveryRefreshFailed ? 'Retry refresh' : 'My passages'
              : savingProgress ? 'Saving…' : sentenceIndex + 1 < sentences.length ? 'Next sentence' : 'Finish passage'}
          </button>
        </div>
      )}
    </section>
  );
}
