import { useCallback, useRef, useState } from 'react';
import styles from '../styles/DragonPhonics.module.css';
import { DragonPrizeReveal } from './DragonPrizeReveal';
import { usePhonicsRound } from '../hooks/usePhonicsRound';
import { MODE_BY_KEY } from '../data/phonicsRounds';
import { speakSoundInWord } from '../utils/speakSound';

/**
 * All three Dragon Phonics sound games, in one component.
 *
 * They are one component rather than three because they differ in exactly two
 * places — what the prompt plays, and how the answer arrives — while sharing the
 * header, the feedback card, the end card and every scoring rule. Three copies
 * of that would drift, and the drift would land in the progress data, where two
 * modes disagreeing about what counts as correct is invisible until a parent
 * reads a number that is wrong.
 *
 * NO HINT DURING PLAY, ON PURPOSE. "Hear it inside a word" is offered only in
 * feedback, never before answering. Hearing /sh/ in "ship" makes the item
 * dramatically easier, so an item answered with the hint and one answered
 * without are not the same evidence — and they would both be stored as one
 * attempt. Replaying the prompt itself is unrestricted; that is the same
 * question asked again.
 *
 * @param {object} props
 * @param {string} props.mode      'choose' | 'type-it' | 'find-in-word'
 * @param {number|number[]|'all'} props.stages
 * @param {string[]} [props.only]  restrict to these element keys (review round)
 * @param {object} [props.mastery] weights which sounds come up
 * @param {(attempts: object[]) => Promise<any>} [props.onSave] called once when a round ends
 * @param {() => void} props.onExit
 */
export function PhonicsGame({ mode, stages, only = null, mastery = null, onSave, onExit }) {
  const modeInfo = MODE_BY_KEY[mode] || MODE_BY_KEY.choose;

  const [typed, setTyped] = useState('');
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'failed'
  const inputRef = useRef(null);

  // The round ends by the child's action, so saving hangs off that action rather
  // than off an effect watching `phase === 'done'`. An effect would re-fire on
  // any re-render in the done phase — a mastery refresh landing, a parent's
  // state change — and post the same attempts again, double-counting the round
  // in the child's history. (usePhonicsRound calls this exactly once per round.)
  const handleFinish = useCallback((attempts) => {
    if (!onSave) return;
    setSaveState('saving');
    Promise.resolve(onSave(attempts))
      .then((out) => setSaveState(out?.error ? 'failed' : 'saved'))
      .catch(() => setSaveState('failed'));
  }, [onSave]);

  const {
    item, index, total, phase, results, answer, lastCorrect,
    correctCount, submit, advance, playAgain, replay,
  } = usePhonicsRound({ mode, stages, only, mastery, onFinish: handleFinish });

  // Clear the box for the next question and put the cursor back in it. Done in
  // the handler rather than an effect on `index`, so the state change belongs to
  // the tap that caused it.
  const nextQuestion = useCallback(() => {
    setTyped('');
    advance();
    if (mode === 'type-it') inputRef.current?.focus();
  }, [advance, mode]);

  // ---------------------------------------------------------------- end card
  if (phase === 'done') {
    const stars = total ? Math.round((correctCount / total) * 5) : 0;
    const ratio = total ? correctCount / total : 0;
    return (
      <div className={styles.page}>
        <div className={styles.endCard}>
          <div className={styles.endDragon} aria-hidden>🐲</div>
          <h2 className={styles.endTitle}>
            {correctCount === total ? 'Perfect ear!' : 'Great listening!'}
          </h2>
          <p className={styles.endScore}>
            You got <strong>{correctCount}</strong> of {total} sounds.
          </p>
          <div className={styles.stars} aria-hidden>
            {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
          </div>

          <p className={styles.saveNote} role="status">
            {saveState === 'saving' && 'Saving your sounds…'}
            {saveState === 'saved' && '✓ Added to your Sound Map'}
            {/* An unsaved round is not lost — usePhonicsProgress carries it into
                the next save — so this says "later", not "gone". */}
            {saveState === 'failed' && '⚠ Could not save yet — it will go in next time'}
          </p>

          <DragonPrizeReveal
            performance={ratio >= 0.8 ? 'high' : ratio >= 0.4 ? 'normal' : 'low'}
          />

          <ul className={styles.recap}>
            {results.map((r, i) => (
              <li key={i} className={r.correct ? styles.recapRight : styles.recapWrong}>
                <span className={styles.recapMark}>{r.correct ? '✓' : '✗'}</span>
                <span className={styles.recapWord}>{r.element.g}</span>
                <span className={styles.recapSound}>{r.element.sound}</span>
                {!r.correct && (
                  <span className={styles.recapYou}>
                    you said {r.typed || r.chosenElement?.g || '—'}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className={styles.endButtons}>
            <button className={styles.primaryBtn} onClick={playAgain}>Play again</button>
            <button className={styles.ghostBtn} onClick={() => onExit?.()}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  if (!item) return null;

  const { element } = item;
  const questionNum = Math.min(index + 1, total);

  // ---------------------------------------------------------------- playing
  return (
    <div className={styles.page}>
      <header className={styles.gameHeader}>
        <button className={styles.quitBtn} onClick={() => onExit?.()}>← quit</button>
        <div className={styles.progressWrap}>
          <span className={styles.progressLabel}>
            {modeInfo.emoji} {questionNum} of {total}
          </span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${(index / total) * 100}%` }} />
          </div>
        </div>
        <span className={styles.scorePill}>{correctCount} ✓</span>
      </header>

      <main className={styles.stage}>
        <button
          type="button"
          className={styles.hearBtn}
          onClick={() => replay()}
          aria-label={mode === 'find-in-word' ? 'Hear the word again' : 'Hear the sound again'}
        >
          <span className={styles.hearIcon} aria-hidden>🔊</span>
          {mode === 'find-in-word' ? 'Hear the word' : 'Hear the sound'}
        </button>

        <p className={styles.prompt}>
          {mode === 'type-it' && 'Type the letters that make this sound.'}
          {mode === 'choose' && 'Which letters make this sound?'}
          {mode === 'find-in-word' && 'Which sound is hiding in that word?'}
        </p>

        {phase === 'feedback' ? (
          <FeedbackCard
            element={element}
            word={item.word}
            mode={mode}
            correct={lastCorrect}
            answer={answer}
            onNext={nextQuestion}
          />
        ) : mode === 'type-it' ? (
          <form
            className={styles.typeForm}
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!typed.trim()) return;
              submit({ typed });
            }}
          >
            <input
              ref={inputRef}
              className={styles.typeInput}
              type="text"
              value={typed}
              onChange={(ev) => setTyped(ev.target.value.replace(/[^a-zA-Z_-]/g, ''))}
              // Phone keyboards "help" in ways that break a phonics answer:
              // autocorrect rewrites `br` to `be`, and capitalisation makes the
              // child's answer look different from what they typed.
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
              inputMode="text"
              maxLength={5}
              aria-label="Type the letters that make this sound"
              placeholder="?"
            />
            <button type="submit" className={styles.typeSubmit} disabled={!typed.trim()}>
              Check
            </button>
          </form>
        ) : (
          <div className={styles.optionRow} role="group" aria-label="Sound choices">
            {item.options.map((option) => (
              <button
                key={option.key}
                type="button"
                className={styles.optionTile}
                onClick={() => submit({ element: option })}
              >
                <span className={styles.optionLetters}>{option.g}</span>
                <span className={styles.optionSound}>{option.sound}</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// The feedback card is where the teaching happens, so it always shows the whole
// truth of the item: the letters, the sound, an example word, and — in the hunt,
// where the word was deliberately never shown — the word itself.
function FeedbackCard({ element, word, mode, correct, answer, onNext }) {
  const said = answer?.typed || answer?.element?.g || '—';
  const example = word || element.words[0];

  return (
    <div className={`${styles.feedbackCard} ${correct ? styles.feedbackRight : styles.feedbackWrong}`}>
      <span className={styles.feedbackMark} aria-hidden>{correct ? '✓' : '✗'}</span>
      <span className={styles.feedbackWord}>
        {element.g} <span className={styles.feedbackSound}>{element.sound}</span>
      </span>

      {!correct && <span className={styles.feedbackYou}>you said: {said}</span>}

      <span className={styles.feedbackExample}>
        {mode === 'find-in-word' ? 'the word was ' : 'as in '}
        <strong>{highlight(example, element)}</strong>
      </span>

      {element.note && <span className={styles.feedbackNote}>{element.note}</span>}

      <button
        type="button"
        className={styles.hintBtn}
        onClick={() => speakSoundInWord(element, example)}
      >
        🔊 hear it in the word
      </button>

      <button type="button" className={styles.feedbackOkBtn} onClick={onNext} autoFocus>
        {correct ? 'OK! 🎉' : 'Got it'}
      </button>
    </div>
  );
}

// Show the element's letters picked out inside the example word, so the child
// sees where the sound lives rather than being told it is in there somewhere.
function highlight(word, element) {
  const w = word.toLowerCase();
  for (const spelling of element.accepts) {
    const s = spelling.toLowerCase();
    if (s.includes('_') || s.includes('-')) continue; // magic-e frame: no literal match
    const at = w.indexOf(s);
    if (at === -1) continue;
    return (
      <>
        {word.slice(0, at)}
        <mark className={styles.mark}>{word.slice(at, at + s.length)}</mark>
        {word.slice(at + s.length)}
      </>
    );
  }
  return word;
}
