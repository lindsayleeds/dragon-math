import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { PHONICS_ELEMENTS, PHONICS_STAGES } from '../data/phonicsCurriculum';

/**
 * A child's phonics mastery: load it, save a finished round into it, and roll it
 * up per stage.
 *
 * The VERDICT is the server's (server/lib/phonicsMastery.js) and is never
 * recomputed here — a second implementation on the client is exactly how a kid's
 * mastery map and their parent's report start disagreeing. What this hook adds
 * is the part the server deliberately cannot do: filling in elements the child
 * has never attempted. The curriculum is frontend data, so the server only knows
 * about sounds that have been practiced, and "23 of 102 mastered" is a claim only
 * something holding the full element list can make.
 */

const EMPTY_STATE = {
  level: 'new',
  attempts: 0,
  correct: 0,
  accuracy: null,
  modes: [],
  lastSeenAt: null,
  stale: false,
  total: 0,
};

// What each mastery level means, in words a child can read. These labels are the
// honest version of the rule in server/lib/phonicsMastery.js — in particular
// `solid` says "one way", because reaching `mastered` needs the sound to be
// right in two different games, and a child staring at a stuck tile deserves to
// know that is what is missing rather than thinking they are just unlucky.
export const LEVEL_INFO = {
  new: { label: 'Not tried yet', short: 'new', emoji: '·', hint: 'You have not met this sound yet.' },
  learning: { label: 'Learning', short: 'learning', emoji: '🌱', hint: 'Getting there — keep practising this one.' },
  solid: { label: 'Got it one way', short: 'solid', emoji: '🌤️', hint: 'Strong in one game. Try it in another game to master it.' },
  mastered: { label: 'Mastered', short: 'mastered', emoji: '⭐', hint: 'You know this sound in more than one way. Nice.' },
};

export function usePhonicsProgress() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped to re-fetch. A counter rather than calling a loader directly, so the
  // fetch stays inside one effect that owns its own cancellation.
  const [tick, setTick] = useState(0);
  // A round the network refused. Kept so the retry on the next save does not
  // silently drop the child's work — see `save` below.
  const pending = useRef([]);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/phonics/mastery')
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setError(null);
      })
      .catch((err) => {
        // A failed load is not a failed game: the round still plays, it is just
        // unweighted and the map is empty until the next successful load.
        if (!cancelled) setError(err?.message || 'Could not load progress');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /**
   * Save a finished round's attempts.
   *
   * Attempts a previous save could not deliver ride along with this one, so a
   * blink of connectivity between two rounds costs nothing. They are only
   * cleared once the server has accepted them.
   */
  const save = useCallback(async (attempts) => {
    const batch = [...pending.current, ...(attempts || [])];
    if (batch.length === 0) return { saved: 0 };
    try {
      const out = await api.post('/api/phonics/attempts', { attempts: batch });
      pending.current = [];
      reload();
      return out;
    } catch (err) {
      pending.current = batch;
      setError(err?.message || 'Could not save this round');
      return { saved: 0, error: err };
    }
  }, [reload]);

  return {
    report,
    mastery: report?.elements || null,
    confusions: report?.confusions || [],
    byMode: report?.by_mode || {},
    loading,
    error,
    reload,
    save,
  };
}

/**
 * Every element with its state, including the ones never attempted.
 * @param {object|null} mastery  `report.elements` from the API
 */
export function fullMastery(mastery) {
  const out = {};
  for (const el of PHONICS_ELEMENTS) {
    out[el.key] = mastery?.[el.key] || EMPTY_STATE;
  }
  return out;
}

/**
 * Per-stage rollup for the mastery map and the parent report.
 *
 * `percent` is mastered-only on purpose. A softer "solid or better" number would
 * read higher and feel better, and would also let a child who has only ever
 * played the multiple-choice game show a full bar — which is the precise claim
 * the two-mode rule exists to refuse.
 */
export function stageSummary(mastery) {
  const full = fullMastery(mastery);
  return PHONICS_STAGES.map((stage) => {
    const counts = { new: 0, learning: 0, solid: 0, mastered: 0, stale: 0 };
    for (const key of stage.elements) {
      const state = full[key];
      counts[state.level] += 1;
      if (state.stale) counts.stale += 1;
    }
    const total = stage.elements.length;
    return {
      ...stage,
      counts,
      total,
      mastered: counts.mastered,
      percent: total ? Math.round((counts.mastered / total) * 100) : 0,
      // Everything the child has met at all — drives "started / not started".
      touched: total - counts.new,
    };
  });
}

/** Program-wide totals, for the one-line headline. */
export function overallSummary(mastery) {
  const full = fullMastery(mastery);
  const counts = { new: 0, learning: 0, solid: 0, mastered: 0, stale: 0 };
  for (const el of PHONICS_ELEMENTS) {
    const state = full[el.key];
    counts[state.level] += 1;
    if (state.stale) counts.stale += 1;
  }
  const total = PHONICS_ELEMENTS.length;
  return {
    ...counts,
    total,
    percent: total ? Math.round((counts.mastered / total) * 100) : 0,
  };
}
