import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAP_NODES, WORLDS, NODE_TYPE } from '../data/mapData';
import styles from '../styles/AdminPage.module.css';

const BASE_URL = 'http://localhost:3001';
const GRID_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const OPS = [
  { value: 'add', label: '+' },
  { value: 'sub', label: '−' },
  { value: 'mul', label: '×' },
];

function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

async function adminFetch(path, password, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function AdminPage() {
  const [password, setPassword] = useState('');
  const [authedPassword, setAuthedPassword] = useState(null);
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  async function handleUnlock(e) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError('');
    try {
      await adminFetch('/api/admin/check', password);
      setAuthedPassword(password);
    } catch (err) {
      setUnlockError(err.message);
    } finally {
      setUnlocking(false);
    }
  }

  if (!authedPassword) {
    return (
      <div className={styles.page}>
        <div className={styles.lockCard}>
          <div className={styles.lockIcon}>🔒</div>
          <h1 className={styles.lockTitle}>Admin</h1>
          <p className={styles.lockDesc}>Enter the admin password to continue.</p>
          <form onSubmit={handleUnlock}>
            <input
              type="password"
              className={styles.lockInput}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
              autoFocus
            />
            <button
              type="submit"
              className={styles.lockBtn}
              disabled={unlocking || !password}
            >
              {unlocking ? 'Checking…' : 'Unlock'}
            </button>
            {unlockError && <p className={styles.lockError}>{unlockError}</p>}
          </form>
          <Link to="/map" className={styles.lockBack}>← Back to map</Link>
        </div>
      </div>
    );
  }

  return <AdminShell password={authedPassword} />;
}

function AdminShell({ password }) {
  const [tab, setTab] = useState('config');
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Admin</h1>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'config' ? styles.tabOn : ''}`}
              onClick={() => setTab('config')}
            >
              Node config
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'analytics' ? styles.tabOn : ''}`}
              onClick={() => setTab('analytics')}
            >
              Analytics
            </button>
          </div>
        </div>
        <Link to="/map" className={styles.headerBack}>← Map</Link>
      </header>
      {tab === 'config'    && <AdminEditor    password={password} />}
      {tab === 'analytics' && <AdminAnalytics password={password} />}
    </div>
  );
}

function AdminEditor({ password }) {
  const [configs, setConfigs] = useState(null);  // { [nodeId]: { grid_size, ops, range_min, range_max, ai_seconds } }
  const [loadError, setLoadError] = useState('');
  const [rowStatus, setRowStatus] = useState({}); // { [nodeId]: 'saving' | 'saved' | 'error:msg' }

  useEffect(() => {
    fetch(`${BASE_URL}/api/node-config`)
      .then(r => r.json())
      .then(({ configs }) => {
        const byId = Object.fromEntries(configs.map(c => [c.node_id, c]));
        setConfigs(byId);
      })
      .catch(err => setLoadError(err.message));
  }, []);

  async function updateNode(nodeId, patch) {
    // Optimistic local update
    setConfigs(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], ...patch } }));
    setRowStatus(prev => ({ ...prev, [nodeId]: 'saving' }));
    try {
      const updated = await adminFetch(`/api/admin/node-config/${nodeId}`, password, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      // Reconcile to server's view (handles validation normalizations like deduped ops)
      setConfigs(prev => ({ ...prev, [nodeId]: updated }));
      setRowStatus(prev => ({ ...prev, [nodeId]: 'saved' }));
      setTimeout(() => {
        setRowStatus(prev => {
          if (prev[nodeId] !== 'saved') return prev;
          const { [nodeId]: _ignore, ...rest } = prev;
          return rest;
        });
      }, 1500);
    } catch (err) {
      setRowStatus(prev => ({ ...prev, [nodeId]: `error:${err.message}` }));
    }
  }

  return (
    <>
      {loadError && <p className={styles.error}>{loadError}</p>}
      {!configs && !loadError && <p className={styles.loading}>Loading…</p>}

      {configs && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Node</th>
                <th>World</th>
                <th>Ops</th>
                <th>Range</th>
                <th>AI sec</th>
                <th>Grid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MAP_NODES.map(node => {
                const cfg = configs[node.id];
                const status = rowStatus[node.id];
                const isBoss = node.type === NODE_TYPE.BOSS;
                if (!cfg) return null;
                return (
                  <tr key={node.id}>
                    <td className={styles.idCell}>{node.id}</td>
                    <td>
                      <span className={styles.nodeIcon}>{node.icon}</span>
                      {node.label}
                      {isBoss && <span className={styles.bossTag}>BOSS</span>}
                    </td>
                    <td className={styles.worldCell}>{worldForNode(node.id)?.name ?? '—'}</td>
                    <td>
                      <OpsPicker
                        value={cfg.ops}
                        onChange={ops => updateNode(node.id, { ops })}
                      />
                    </td>
                    <td>
                      <RangeEditor
                        rangeMin={cfg.range_min}
                        rangeMax={cfg.range_max}
                        onCommit={patch => updateNode(node.id, patch)}
                      />
                    </td>
                    <td>
                      <NumberInput
                        value={cfg.ai_seconds}
                        step={0.1}
                        min={0.5}
                        max={60}
                        onCommit={v => updateNode(node.id, { ai_seconds: v })}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.sizeSelect}
                        value={cfg.grid_size}
                        onChange={e => updateNode(node.id, { grid_size: Number(e.target.value) })}
                      >
                        {GRID_OPTIONS.map(n => (
                          <option key={n} value={n}>{n}×{n}</option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.statusCell}>
                      {status === 'saving' && <span className={styles.saving}>saving…</span>}
                      {status === 'saved' && <span className={styles.saved}>✓ saved</span>}
                      {status?.startsWith('error:') && (
                        <span className={styles.errorInline}>{status.slice(6)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const OP_SYMBOL = { add: '+', sub: '−', mul: '×' };

function formatMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' in UTC. Parse as UTC.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function winPct(child, total) {
  if (!total) return '—';
  return `${Math.round((child / total) * 100)}%`;
}

const DAY_OPTIONS = [
  { value: 1,    label: 'Last 24h' },
  { value: 7,    label: 'Last 7 days' },
  { value: 30,   label: 'Last 30 days' },
  { value: 0,    label: 'All time' },
];

function AdminAnalytics({ password }) {
  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  // Load user list once.
  useEffect(() => {
    adminFetch('/api/admin/users', password)
      .then(({ users }) => {
        setUsers(users);
        // Auto-select the user with the most attempts.
        if (users.length > 0 && !selectedUserId) {
          const top = [...users].sort((a, b) => (b.attempt_count || 0) - (a.attempt_count || 0))[0];
          setSelectedUserId(String(top.id));
        }
      })
      .catch(err => setUsersError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  // Load analytics whenever user or window changes.
  useEffect(() => {
    if (!selectedUserId) { setData(null); return; }
    setLoadingData(true);
    setDataError('');
    const qs = days > 0 ? `?days=${days}` : '';
    adminFetch(`/api/admin/analytics/${selectedUserId}${qs}`, password)
      .then(setData)
      .catch(err => { setData(null); setDataError(err.message); })
      .finally(() => setLoadingData(false));
  }, [password, selectedUserId, days]);

  if (usersError) return <p className={styles.error}>{usersError}</p>;
  if (!users) return <p className={styles.loading}>Loading…</p>;

  return (
    <div className={styles.analyticsWrap}>
      <div className={styles.controls}>
        <label className={styles.controlLabel}>
          Child
          <select
            className={styles.sizeSelect}
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
          >
            {users.length === 0 && <option value="">(no users yet)</option>}
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.avatar} {u.username} · {u.attempt_count || 0} attempts
              </option>
            ))}
          </select>
        </label>
        <label className={styles.controlLabel}>
          Window
          <select
            className={styles.sizeSelect}
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            {DAY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      {dataError && <p className={styles.error}>{dataError}</p>}
      {loadingData && <p className={styles.loading}>Loading…</p>}

      {data && !loadingData && (
        <AnalyticsBody data={data} />
      )}
    </div>
  );
}

function AnalyticsBody({ data }) {
  const { summary, byOperator, hardProblems, fastestProblems, confusions, recentAttempts } = data;
  const total = summary?.total || 0;

  if (total === 0) {
    return <p className={styles.emptyMsg}>No attempts logged for this child in this window yet.</p>;
  }

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Problems answered" value={total} />
        <StatCard label="Child won"  value={summary.child_wins} sub={winPct(summary.child_wins, total)} accent="good" />
        <StatCard label="AI won"     value={summary.ai_wins}    sub={winPct(summary.ai_wins, total)}    accent="bad" />
        <StatCard label="Avg child time"  value={formatMs(summary.avg_child_ms)} />
        <StatCard label="Avg AI time"     value={formatMs(summary.avg_ai_ms)} />
      </div>

      <Section title="By operator">
        {byOperator.length === 0 ? (
          <p className={styles.emptyMsg}>No data.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Op</th><th>Total</th><th>Child won</th><th>AI won</th><th>Child win %</th><th>Avg child time</th></tr>
            </thead>
            <tbody>
              {byOperator.map(row => (
                <tr key={row.operator}>
                  <td className={styles.opCell}>{OP_SYMBOL[row.operator] || row.operator}</td>
                  <td>{row.total}</td>
                  <td>{row.child_wins}</td>
                  <td>{row.ai_wins}</td>
                  <td>{winPct(row.child_wins, row.total)}</td>
                  <td>{formatMs(row.avg_child_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Hardest problems (most AI wins / slowest)">
        {hardProblems.length === 0 ? (
          <p className={styles.emptyMsg}>Not enough data yet — needs ≥2 attempts per problem.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Problem</th><th>= </th><th>Total</th><th>Child</th><th>AI</th><th>Avg child time</th></tr>
            </thead>
            <tbody>
              {hardProblems.map((row, i) => (
                <tr key={i}>
                  <td className={styles.problemCell}>{row.operand_a} {OP_SYMBOL[row.operator]} {row.operand_b}</td>
                  <td>{row.answer}</td>
                  <td>{row.total}</td>
                  <td>{row.child_wins}</td>
                  <td className={row.ai_wins > 0 ? styles.badCell : ''}>{row.ai_wins}</td>
                  <td>{formatMs(row.avg_child_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Fastest recall (child won, lowest avg time)">
        {fastestProblems.length === 0 ? (
          <p className={styles.emptyMsg}>Not enough data yet — needs ≥2 child wins per problem.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Problem</th><th>= </th><th>Child wins</th><th>Avg time</th></tr>
            </thead>
            <tbody>
              {fastestProblems.map((row, i) => (
                <tr key={i}>
                  <td className={styles.problemCell}>{row.operand_a} {OP_SYMBOL[row.operator]} {row.operand_b}</td>
                  <td>{row.answer}</td>
                  <td>{row.child_wins}</td>
                  <td className={styles.goodCell}>{formatMs(row.avg_child_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Top confusions (wrong cells tapped)">
        {confusions.length === 0 ? (
          <p className={styles.emptyMsg}>No wrong taps logged yet.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Problem</th><th>Correct</th><th>Tapped</th><th>Times</th></tr>
            </thead>
            <tbody>
              {confusions.map((row, i) => (
                <tr key={i}>
                  <td className={styles.problemCell}>{row.operand_a} {OP_SYMBOL[row.operator]} {row.operand_b}</td>
                  <td>{row.correct_answer}</td>
                  <td className={styles.badCell}>{row.tapped_value}</td>
                  <td>{row.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Recent activity">
        <table className={styles.subTable}>
          <thead>
            <tr><th>When</th><th>Node</th><th>Problem</th><th>= </th><th>Time</th><th>Winner</th></tr>
          </thead>
          <tbody>
            {recentAttempts.map((row, i) => (
              <tr key={i}>
                <td className={styles.timeCell}>{formatTimestamp(row.created_at)}</td>
                <td>{row.node_id}</td>
                <td className={styles.problemCell}>{row.operand_a} {OP_SYMBOL[row.operator]} {row.operand_b}</td>
                <td>{row.answer}</td>
                <td>{formatMs(row.time_ms)}</td>
                <td className={row.outcome === 'child' ? styles.goodCell : styles.badCell}>
                  {row.outcome === 'child' ? '👧 child' : '🤖 AI'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function StatCard({ label, value, sub, accent }) {
  const accentClass = accent === 'good' ? styles.statGood : accent === 'bad' ? styles.statBad : '';
  return (
    <div className={`${styles.statCard} ${accentClass}`}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

function OpsPicker({ value, onChange }) {
  const selected = new Set(value);
  function toggle(op) {
    const next = new Set(selected);
    if (next.has(op)) {
      if (next.size === 1) return; // can't remove the last op
      next.delete(op);
    } else {
      next.add(op);
    }
    onChange(Array.from(next));
  }
  return (
    <div className={styles.opsPicker}>
      {OPS.map(op => (
        <button
          key={op.value}
          type="button"
          className={`${styles.opChip} ${selected.has(op.value) ? styles.opChipOn : ''}`}
          onClick={() => toggle(op.value)}
          title={op.value}
        >
          {op.label}
        </button>
      ))}
    </div>
  );
}

function RangeEditor({ rangeMin, rangeMax, onCommit }) {
  return (
    <div className={styles.rangeRow}>
      <NumberInput
        value={rangeMin}
        step={1}
        min={0}
        max={999}
        onCommit={v => onCommit({ range_min: v })}
      />
      <span className={styles.rangeDash}>–</span>
      <NumberInput
        value={rangeMax}
        step={1}
        min={1}
        max={999}
        onCommit={v => onCommit({ range_max: v })}
      />
    </div>
  );
}

// Controlled number input that commits on blur / Enter to avoid saving on
// every keystroke. Mirrors the prop value when the parent updates externally
// (e.g., after a server reconcile), without clobbering an in-progress edit.
function NumberInput({ value, step, min, max, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  // React's recommended pattern for syncing state with a changing prop: set
  // during render rather than in an effect (avoids a wasted render).
  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setDraft(String(value));
  }

  function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    onCommit(parsed);
  }

  return (
    <input
      type="number"
      className={styles.numberInput}
      value={draft}
      step={step}
      min={min}
      max={max}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
