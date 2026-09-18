import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ELEMENT_BY_KEY } from '../data/phonicsCurriculum';
import { stageSummary, overallSummary, fullMastery } from '../hooks/usePhonicsProgress';
import { MODE_BY_KEY } from '../data/phonicsRounds';
import styles from '../styles/ParentDashboard.module.css';
import phonics from '../styles/DragonPhonics.module.css';

/**
 * The grown-up's phonics report for one child.
 *
 * Reads the SAME endpoint and the same rollup helpers as the child's own Sound
 * Map (`/api/phonics/mastery/:childId` vs `/api/phonics/mastery`, both
 * `buildReport()` on the server). That is deliberate: a parent and a child
 * looking at the same sounds and reading different numbers is worse than either
 * of them having no report at all.
 *
 * What differs is the framing, not the data. A child gets a map to work through;
 * a parent gets the three questions they actually have — how far through the
 * code is this child, what are they stuck on, and is the result trustworthy.
 * That last one is why "how they have been tested" is on the page: mastery here
 * requires being right in two different game modes, and a parent deserves to see
 * whether their child has only ever played the easy one.
 */
export function ParentPhonicsReport({ childId, childName }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  // Starts true and is only ever lowered from the async callbacks below; raising
  // it synchronously inside the effect would be a cascading render
  // (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/phonics/mastery/${childId}`)
      .then((data) => { if (!cancelled) { setReport(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [childId]);

  const mastery = report?.elements || null;
  const stages = useMemo(() => stageSummary(mastery), [mastery]);
  const overall = useMemo(() => overallSummary(mastery), [mastery]);
  const full = useMemo(() => fullMastery(mastery), [mastery]);

  // What to work on next: still-learning sounds, weakest first, then anything
  // that has gone stale. Capped — a list of forty is not an action.
  const workOn = useMemo(() => {
    if (!mastery) return [];
    return Object.entries(full)
      .filter(([, s]) => s.level === 'learning' && s.attempts > 0)
      .sort((a, b) => (a[1].accuracy ?? 0) - (b[1].accuracy ?? 0))
      .slice(0, 8)
      .map(([key, s]) => ({ el: ELEMENT_BY_KEY[key], state: s }))
      .filter((r) => r.el);
  }, [full, mastery]);

  const stale = useMemo(() => {
    if (!mastery) return [];
    return Object.entries(full)
      .filter(([, s]) => s.stale)
      .slice(0, 10)
      .map(([key]) => ELEMENT_BY_KEY[key])
      .filter(Boolean);
  }, [full, mastery]);

  const confusions = (report?.confusions || [])
    .map((c) => ({ ...c, a: ELEMENT_BY_KEY[c.element], b: ELEMENT_BY_KEY[c.chose] }))
    .filter((c) => c.a && c.b);

  if (loading) return <p className={styles.muted}>Loading phonics…</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  if (!report || report.total_attempts === 0) {
    return (
      <p className={styles.muted}>
        {childName ? `${childName} has` : 'This child has'} not played Dragon Phonics yet.
        It is in the Learning Lair under <strong>Phonics</strong>.
      </p>
    );
  }

  const modeRows = Object.entries(report.by_mode || {})
    .map(([key, v]) => ({ key, ...v, info: MODE_BY_KEY[key] }))
    .filter((r) => r.info)
    .sort((a, b) => b.attempts - a.attempts);

  return (
    <div>
      <div
        className={styles.cardGrid}
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
      >
        <div className={styles.statBox}>
          <div className={styles.statValue}>{overall.mastered}/{overall.total}</div>
          <div className={styles.statLabel}>sounds mastered</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statValue}>{overall.solid}</div>
          <div className={styles.statLabel}>solid in one game</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statValue}>{overall.learning}</div>
          <div className={styles.statLabel}>still learning</div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statValue}>{overall.new}</div>
          <div className={styles.statLabel}>not met yet</div>
        </div>
      </div>

      {/* What "mastered" is a claim about. Stated up front because the number
          above means nothing without it. */}
      <p className={styles.muted} style={{ marginTop: '0.75rem' }}>
        A sound counts as <strong>mastered</strong> only when it is answered correctly
        in at least two different games — recognising it, spelling it, and finding it
        inside a spoken word are different skills, and the multiple-choice game alone
        can be passed by elimination. Everything is judged on the
        last {report.recent_window} attempts, so an old bad patch stops counting once
        it has been put right.
      </p>

      <h3 style={{ margin: '1.25rem 0 0.5rem' }}>Through the code</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Mastered</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.key}>
              <td>{s.emoji} {s.label}</td>
              <td>{s.mastered} / {s.total}</td>
              <td>
                <div className={phonics.mapStageBar} style={{ margin: 0, minWidth: '80px' }}>
                  <div className={phonics.mapStageFill} style={{ width: `${s.percent}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {workOn.length > 0 && (
        <>
          <h3 style={{ margin: '1.25rem 0 0.5rem' }}>Work on these next</h3>
          <div className={phonics.tileGrid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}>
            {workOn.map(({ el, state }) => (
              <div
                key={el.key}
                className={`${phonics.tile} ${phonics.tile_learning}`}
                title={`${el.sound} — ${state.correct} of last ${state.attempts} correct`}
              >
                <span className={phonics.tileLetters}>{el.g}</span>
              </div>
            ))}
          </div>
          <p className={styles.muted} style={{ marginTop: '0.5rem' }}>
            {workOn.map(({ el }) => `${el.g} (${el.sound} as in ${el.words[0]})`).join(' · ')}
          </p>
        </>
      )}

      {confusions.length > 0 && (
        <>
          <h3 style={{ margin: '1.25rem 0 0.5rem' }}>Sounds being mixed up</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Hears</th>
                <th>Answers</th>
                <th>Times</th>
              </tr>
            </thead>
            <tbody>
              {confusions.map((c) => (
                <tr key={`${c.element}-${c.chose}`}>
                  <td><strong>{c.a.g}</strong> {c.a.sound} <span className={styles.muted}>as in {c.a.words[0]}</span></td>
                  <td><strong>{c.b.g}</strong> {c.b.sound} <span className={styles.muted}>as in {c.b.words[0]}</span></td>
                  <td>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.muted} style={{ marginTop: '0.5rem' }}>
            These are repeated mistakes, not one-offs — a pair only appears after the
            same swap happens twice. Saying the two sounds back to back is usually
            enough to split them apart.
          </p>
        </>
      )}

      {stale.length > 0 && (
        <p className={styles.muted} style={{ marginTop: '1rem' }}>
          🔁 Not practised in a while, so these are due a re-check:{' '}
          {stale.map((el) => el.g).join(', ')}.
        </p>
      )}

      <h3 style={{ margin: '1.25rem 0 0.5rem' }}>How they have been tested</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Game</th>
            <th>What it proves</th>
            <th>Questions</th>
            <th>Correct</th>
          </tr>
        </thead>
        <tbody>
          {modeRows.map((r) => (
            <tr key={r.key}>
              <td>{r.info.emoji} {r.info.name}</td>
              <td className={styles.muted}>{r.info.skill}</td>
              <td>{r.attempts}</td>
              <td>{r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {modeRows.length < 2 && (
        <p className={styles.muted} style={{ marginTop: '0.5rem' }}>
          Only one game has been played so far, so nothing can reach <strong>mastered</strong> yet.
          Trying a second game is the fastest way to turn the solid sounds into mastered ones.
        </p>
      )}
    </div>
  );
}
