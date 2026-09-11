import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { soundEffects } from '../utils/soundEffects';
import {
  firstMemoryLetter,
  hiddenWordIndexes,
  normalizeMemoryWord,
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

  function goBack() {
    if (phase === 'pick') navigate('/learning-lair');
    else if (phase === 'level') { setSelected(null); setPhase('pick'); }
    else if (phase === 'study') setPhase('level');
    else if (phase === 'practice') setPhase('study');
    else { setSelected(null); setDifficulty(null); setPhase('pick'); }
  }

  function finishPassage() {
    const level = LEVEL_NUMBER[difficulty] || 0;
    setPassages(current => current.map(passage => passage.id === selected.id
      ? { ...passage, mastery_level: Math.max(Number(passage.mastery_level) || 0, level) }
      : passage));
    setPhase('done');
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
          <MemoryPractice key={`${selected.id}:${difficulty}`} passage={selected} difficulty={difficulty} onComplete={finishPassage} />
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

function MemoryPractice({ passage, difficulty, onComplete }) {
  const sentences = useMemo(() => splitPassage(passage.body), [passage.body]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [revealed, setRevealed] = useState([]);
  const [usedTiles, setUsedTiles] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [hardIndex, setHardIndex] = useState(0);
  const [sentenceDone, setSentenceDone] = useState(false);
  const [message, setMessage] = useState('');

  const sentence = sentences[sentenceIndex] || '';
  const words = useMemo(() => passageWords(sentence), [sentence]);
  const hidden = useMemo(() => hiddenWordIndexes(words, sentenceIndex), [words, sentenceIndex]);
  const easyTiles = useMemo(() => shuffledTiles(hidden.map(index => words[index])), [hidden, words]);
  const mediumTiles = useMemo(() => shuffledTiles(words), [words]);

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
    try {
      await api.post(`/api/memory-passages/${passage.id}/progress`, { difficulty });
    } catch {
      // The celebration should still finish if progress cannot sync.
    }
    onComplete();
  }

  const ending = sentence.match(/[.!?]+[”"']?$/)?.[0] || '';
  const chosenWords = chosen.map(id => mediumTiles.find(tile => tile.id === id)?.word).filter(Boolean);

  return (
    <section className={styles.practicePage}>
      <div className={styles.progress}>Sentence {sentenceIndex + 1} of {sentences.length}</div>
      <h2>{passage.title}</h2>

      {difficulty === 'easy' && (
        <>
          <div className={styles.wordLine} aria-label="Sentence with missing words">
            {words.map((word, index) => hidden.includes(index) && !revealed.includes(index)
              ? <span className={styles.blank} key={`${word}:${index}`}>{'_'.repeat(Math.min(word.length, 10))}</span>
              : <span key={`${word}:${index}`}>{word}</span>)}
            <span>{ending}</span>
          </div>
          <p className={styles.instruction}>Choose the words in blank order.</p>
          <div className={styles.tileTray}>
            {easyTiles.map(tile => <button key={tile.id} disabled={usedTiles.includes(tile.id)} onClick={() => pickEasy(tile)}>{tile.word}</button>)}
          </div>
        </>
      )}

      {difficulty === 'medium' && (
        <>
          <div className={styles.buildLine}>{chosenWords.length > 0 ? chosenWords.join(' ') : 'Build the sentence here…'}{sentenceDone && ending}</div>
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
            {words.map((word, index) => (
              <span className={index === hardIndex ? styles.currentBlank : ''} key={`${word}:${index}`}>
                {index < hardIndex ? word : '_'.repeat(Math.min(word.length, 10))}
              </span>
            ))}
            <span>{ending}</span>
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
          <button className={styles.primaryButton} onClick={advance}>{sentenceIndex + 1 < sentences.length ? 'Next sentence' : 'Finish passage'}</button>
        </div>
      )}
    </section>
  );
}
