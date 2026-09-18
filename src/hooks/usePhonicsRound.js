import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRound, toAttempt, QUESTIONS_PER_ROUND } from '../data/phonicsRounds';
import { isAcceptedSpelling } from '../data/phonicsCurriculum';
import { speakSound, speakSoundInWord, primeSounds } from '../utils/speakSound';
import { speakWord } from '../utils/speakWord';
import { soundEffects } from '../utils/soundEffects';

/**
 * One round of Dragon Phonics, shared by all three sound games.
 *
 * They differ in exactly two places — what the prompt plays, and how the answer
 * arrives (tap an element, or type letters) — while sharing the round, the
 * scoring, the timing and the attempt records. Three copies of that would drift,
 * and the drift would land in the progress data, where two modes disagreeing
 * about what counts as correct is invisible until a parent reads a wrong number.
 *
 * WHY ONE STATE OBJECT RATHER THAN SEVEN PIECES OF STATE.
 *
 * An answer can land after the item has already moved on — a double tap, or a
 * key repeat while feedback is rendering. Split state plus a stale closure would
 * score that against the NEXT sound, quietly recording a wrong answer for an
 * element the child never heard. Holding the round, the position, the phase and
 * the results together means every write is a functional updater that re-checks
 * `prev.phase`, so a late answer is dropped against the state it was actually
 * given in. The guard is in the updater and not only in the handler because two
 * taps in one batch share a render, and the handler's `state` would say 'play'
 * for both.
 *
 * The round is DEALT during render when `dealKey` changes (the pattern React
 * documents for adjusting state on a prop change) rather than in an effect, so
 * the child never sees a frame of the previous round's questions. `mastery` is
 * deliberately absent from `dealKey`: it changes the moment a round's own
 * results are saved, and re-dealing then would throw away the round in progress.
 *
 * @param {object} opts
 * @param {string} opts.mode      'choose' | 'type-it' | 'find-in-word'
 * @param {number|number[]|'all'} opts.stages
 * @param {string[]} [opts.only]  restrict to these element keys (review round)
 * @param {object} [opts.mastery] weights which sounds come up; see pickRoundElements
 * @param {number} [opts.count]
 * @param {(attempts: object[], summary: object) => void} [opts.onFinish]
 *        called once per round, from the answer that ends it. A callback rather
 *        than an effect on `phase === 'done'` so saving is triggered by the
 *        child's action rather than by a render.
 */
export function usePhonicsRound({
  mode,
  stages,
  only = null,
  mastery = null,
  count = QUESTIONS_PER_ROUND,
  onFinish,
}) {
  // A stable string for "these are different questions". The arrays would
  // compare by identity and re-deal on every render.
  const stagesKey = Array.isArray(stages) ? stages.join(',') : String(stages);
  const onlyKey = only ? only.join(',') : '';
  const dealKey = `${mode}|${stagesKey}|${onlyKey}|${count}`;

  const deal = useCallback((key, roundNumber, masteryNow) => ({
    key,
    round: roundNumber,
    items: buildRound({ mode, stages, count, mastery: masteryNow, only }),
    index: 0,
    phase: 'play',
    results: [],
    answer: null,
    lastCorrect: false,
  }), [mode, stages, count, only]);

  const [stored, setState] = useState(() => deal(dealKey, 0, mastery));

  // Re-deal during render when the questions should change. Setting state here
  // is the sanctioned "adjust state on a prop change" escape hatch: React throws
  // away this render and redoes it before committing anything. `state` (not
  // `stored`) is used below so this pass already renders the new round rather
  // than one frame of the old one.
  let state = stored;
  if (stored.key !== dealKey) {
    state = deal(dealKey, 0, mastery);
    setState(state);
  }

  const items = state.items;
  const item = items[state.index] ?? null;

  // When the prompt finished playing, so "how long did they think" measures
  // thinking rather than listening. A ref because it is written from an async
  // callback and read from an event handler — never during render.
  const promptDoneAt = useRef(null);
  // Rounds already handed to `onFinish`, so a double tap on the last "OK" can
  // not save the same round twice.
  const finishedRound = useRef(null);

  // The latest callback, so the prompt effect does not re-fire (and re-speak the
  // word) just because a parent passed a new inline function.
  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  useEffect(() => {
    primeSounds(items.map((i) => i.element));
  }, [items]);

  // What the prompt IS differs by mode: the sound games play the isolated sound,
  // the hunt plays the whole word.
  const speakItem = useCallback((current) => {
    if (!current) return Promise.resolve();
    promptDoneAt.current = null;
    const done = mode === 'find-in-word'
      ? speakWord(current.word)
      : speakSound(current.element);
    return done.then(() => { promptDoneAt.current = Date.now(); });
  }, [mode]);

  const replay = useCallback(() => speakItem(item), [speakItem, item]);

  useEffect(() => {
    const current = items[state.index];
    if (!current || state.phase !== 'play') return;
    speakItem(current);
    // Keyed on the position and the deal, not on `speakItem`/`item` identity —
    // otherwise an unrelated re-render would talk over the child.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, state.key, state.round]);

  // Feedback sound and the teaching replay, fired once per RECORDED answer. This
  // is keyed on the results length rather than done inside `submit` because only
  // answers the updater actually accepted appear there — a dropped late tap must
  // not ding.
  const answeredCount = state.results.length;
  useEffect(() => {
    const last = state.results[answeredCount - 1];
    if (!last) return;
    if (last.correct) {
      soundEffects.playCorrect();
    } else {
      soundEffects.playWrong();
      // A wrong answer is the teaching moment: hear the sound inside a real word
      // rather than just being told no.
      speakSoundInWord(last.element, last.word || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredCount, state.key, state.round]);

  /**
   * Record an answer.
   * @param {object} given
   * @param {object} [given.element]  the element the child tapped (tap modes)
   * @param {string} [given.typed]    what the child typed (type-it)
   */
  const submit = useCallback((given) => {
    const chosenElement = given?.element ?? null;
    const typed = given?.typed ?? null;
    const responseMs = promptDoneAt.current == null ? null : Date.now() - promptDoneAt.current;

    setState((prev) => {
      // The late-answer guard. Two taps batched into one render would both see
      // `phase === 'play'` in the handler's closure; only the first gets past
      // this, so the second cannot be scored against the next sound.
      if (prev.phase !== 'play') return prev;
      const current = prev.items[prev.index];
      if (!current) return prev;

      const correct = typed != null
        ? isAcceptedSpelling(current.element, typed)
        : chosenElement?.key === current.element.key;

      return {
        ...prev,
        results: [...prev.results, {
          element: current.element,
          word: current.word,
          correct,
          chosenElement,
          typed,
          attempt: toAttempt({
            element: current.element,
            mode,
            correct,
            chosenElement,
            typed,
            responseMs,
          }),
        }],
        answer: { element: chosenElement, typed },
        lastCorrect: correct,
        phase: 'feedback',
      };
    });
  }, [mode]);

  const advance = useCallback(() => {
    if (state.phase !== 'feedback') return;
    const isLast = state.index + 1 >= state.items.length;

    setState((prev) => {
      if (prev.phase !== 'feedback') return prev;
      return prev.index + 1 >= prev.items.length
        ? { ...prev, phase: 'done' }
        : { ...prev, index: prev.index + 1, phase: 'play', answer: null };
    });

    if (!isLast) return;
    // Exactly once per round: a second tap on the final "OK" must not save the
    // round again and double-count it in the child's history.
    const roundId = `${state.key}:${state.round}`;
    if (finishedRound.current === roundId) return;
    finishedRound.current = roundId;

    const correctCount = state.results.filter((r) => r.correct).length;
    if (correctCount > 0 && correctCount === state.items.length) soundEffects.playCorrect();
    onFinishRef.current?.(
      state.results.map((r) => r.attempt),
      { correct: correctCount, total: state.items.length, round: state.round },
    );
  }, [state]);

  const playAgain = useCallback(() => {
    setState((prev) => deal(prev.key, prev.round + 1, mastery));
  }, [deal, mastery]);

  const correctCount = state.results.filter((r) => r.correct).length;

  return {
    item,
    index: state.index,
    total: items.length,
    phase: state.phase,
    results: state.results,
    answer: state.answer,
    lastCorrect: state.lastCorrect,
    correctCount,
    attempts: state.results.map((r) => r.attempt),
    submit,
    advance,
    playAgain,
    replay,
  };
}
