import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { WORLDS } from '../data/mapData';
import { useDialog } from '../components/ConfirmModal';
import styles from '../styles/ParentDashboard.module.css';

const OP_LABEL = { add: '+', sub: '−', mul: '×', div: '÷' };
const OP_NAME = { add: 'addition', sub: 'subtraction', mul: 'multiplication', div: 'division' };
const BAND_LABEL = {
  fluent:     '★★★★★ fluent',
  capable:    '★★★★☆ capable',
  developing: '★★★☆☆ developing',
  emerging:   '★★☆☆☆ emerging',
  not_ready:  '★☆☆☆☆ not ready',
};
const TRIAL_OPS = ['add', 'sub', 'mul', 'div'];

function fmtTrialDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMs(ms) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}
function pct(num, denom) {
  if (!denom) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}
function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

export function ParentChildStatsPage() {
  const { childId } = useParams();
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trialResetMsg, setTrialResetMsg] = useState(null);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    setLoading(true);
    api.get(`/api/parent/children/${childId}/stats?days=${days}`)
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [childId, days]);

  async function handleResetTrial() {
    setTrialResetMsg(null);
    const ok = await confirm({
      title: "Reset Dragon's Trial?",
      message: "Your child will be able to take the placement test again. Their current map progress is preserved.",
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/api/parent/children/${childId}/reset-trial`);
      setTrialResetMsg("Dragon's Trial reset — your child will see the offer the next time they visit the map.");
    } catch (err) {
      setTrialResetMsg(`Could not reset: ${err.message}`);
    }
  }

  if (loading && !stats) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;
  if (error) return <div className={styles.page}><p className={styles.error}>{error}</p></div>;
  if (!stats) return null;

  const { user, summary, byOperator, hardProblems, confusions, playtime, matches, trial } = stats;
  const totalProblems = summary?.total || 0;
  const childWins = summary?.child_wins || 0;
  const maxPlay = Math.max(1, ...playtime.by_day.map(d => d.minutes));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link to="/parent" className={styles.linkBtn}>← Back to dashboard</Link>
          <h1 className={styles.title}>{user.avatar} {user.username}</h1>
        </div>
        <div>
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value, 10))}
            className={styles.input}
            style={{ padding: '0.4rem 0.7rem' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </header>

      <section className={styles.section}>
        <h2>Snapshot</h2>
        <div className={styles.cardGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Stat label="Problems solved" value={totalProblems} />
          <Stat label="Accuracy" value={pct(childWins, totalProblems)} />
          <Stat label="Avg solve time" value={fmtMs(summary?.avg_child_ms)} />
          <Stat label="Battles won" value={`${matches?.child_wins || 0} of ${matches?.total || 0}`} />
          <Stat label={`Play time (${days}d)`} value={`${playtime.minutes_in_window} min`} />
          <Stat label="Today" value={`${playtime.minutes_today} min`} />
        </div>
      </section>

      <section className={styles.section}>
        <h2>Daily play time</h2>
        <div className={styles.playChart}>
          {playtime.by_day.map(d => (
            <div key={d.day} className={styles.playCol} title={`${d.day}: ${d.minutes} min`}>
              <div
                className={styles.playFill}
                style={{ height: `${(d.minutes / maxPlay) * 100}%` }}
              />
              <div className={styles.playLabel}>{d.day.slice(5)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>By operation</h2>
        {byOperator.length === 0 ? (
          <p className={styles.muted}>No problems in this window yet.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Op</th><th>Solved</th><th>Accuracy</th><th>Avg time</th></tr></thead>
            <tbody>
              {byOperator.map(r => (
                <tr key={r.operator}>
                  <td className={styles.opCell}>{OP_LABEL[r.operator] || r.operator}</td>
                  <td>{r.total}</td>
                  <td>{pct(r.child_wins, r.total)}</td>
                  <td>{fmtMs(r.avg_child_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2>Trickiest problems</h2>
        {hardProblems.length === 0 ? (
          <p className={styles.muted}>Not enough data yet — keep playing!</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Problem</th><th>Tries</th><th>Accuracy</th><th>Avg time</th></tr></thead>
            <tbody>
              {hardProblems.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.operand_a} {OP_LABEL[r.operator]} {r.operand_b} = {r.answer}</strong></td>
                  <td>{r.total}</td>
                  <td>{pct(r.child_wins, r.total)}</td>
                  <td>{fmtMs(r.avg_child_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2>Dragon's Trial</h2>
        {trial ? (
          <>
            <p className={styles.muted} style={{ marginTop: 0 }}>
              Placement test taken {fmtTrialDate(trial.taken_at)}. Highest fluency:{' '}
              <strong>{trial.highest_op ? OP_NAME[trial.highest_op] : 'still building foundations'}</strong>.
            </p>
            <table className={styles.table}>
              <thead><tr><th>Op</th><th>Score</th><th>Result</th><th>Problems asked</th></tr></thead>
              <tbody>
                {TRIAL_OPS.map(op => {
                  const r = trial.per_op[op];
                  return (
                    <tr key={op}>
                      <td className={styles.opCell}>{OP_LABEL[op]}</td>
                      <td>{r.score} / 1000</td>
                      <td>{BAND_LABEL[r.band] || r.band}</td>
                      <td>{r.asked}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className={styles.muted} style={{ marginTop: 0 }}>
            Your child hasn't taken the placement test yet.
          </p>
        )}
        <p className={styles.muted} style={{ marginTop: '0.9rem' }}>
          Reset the trial if your child wants to retake it — their current map progress is preserved.
        </p>
        <button
          type="button"
          onClick={handleResetTrial}
          className={styles.linkBtn}
          style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ↻ reset Dragon's Trial
        </button>
        {trialResetMsg && (
          <p className={styles.muted} style={{ marginTop: '0.6rem' }}>{trialResetMsg}</p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Common mix-ups</h2>
        {confusions.length === 0 ? (
          <p className={styles.muted}>No common mix-ups yet.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Problem</th><th>Tapped instead</th><th>Times</th></tr></thead>
            <tbody>
              {confusions.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.operand_a} {OP_LABEL[r.operator]} {r.operand_b} = {r.correct_answer}</strong></td>
                  <td>{r.tapped_value}</td>
                  <td>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {dialog}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
