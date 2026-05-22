import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAP_NODES, WORLDS, NODE_TYPE } from '../data/mapData';
import { BATTLE_SHAPES_LIST } from '../data/battleShapes';
import { useDialog } from '../components/ConfirmModal';
import styles from '../styles/AdminPage.module.css';

const BASE_URL = '';
// Shapes sorted small → large so World 1's 5-cell shapes cluster at the top
// and bosses' big shapes fall to the bottom — the option list reads like the
// natural difficulty ramp.
const SHAPE_OPTIONS = [...BATTLE_SHAPES_LIST].sort((a, b) => a.cells - b.cells);
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
      <div className={styles.lockPage}>
        <div className={styles.lockDoodles} aria-hidden="true">
          <span className={`${styles.lockDoodle} ${styles.lockDoodleStarSky}`}>✦</span>
          <span className={`${styles.lockDoodle} ${styles.lockDoodleStarMust}`}>★</span>
          <span className={`${styles.lockDoodle} ${styles.lockDoodleStarSage}`}>✦</span>
          <span className={`${styles.lockDoodle} ${styles.lockDoodleSparkle}`}>· · ✦ · ·</span>
          <span className={`${styles.lockDoodleNote} ${styles.lockDoodleNoteTop}`}>shh — keepers only</span>
          <span className={`${styles.lockDoodleNote} ${styles.lockDoodleNoteBottom}`}>— back of the journal</span>
        </div>

        <div className={styles.lockCard}>
          <span className={styles.lockWashiLeft} aria-hidden="true" />
          <span className={styles.lockWashiRight} aria-hidden="true" />

          <div className={styles.lockLogo}>
            <span className={styles.lockLogoDragon} aria-hidden="true">🐉</span>
            <div className={styles.lockLogoTitleWrap}>
              <h1 className={styles.lockLogoTitle}>My Dragon Math</h1>
            </div>
          </div>

          <h2 className={styles.lockFormTitle}>Keeper&rsquo;s door</h2>
          <p className={styles.lockDesc}>Whisper the keeper&rsquo;s word to step inside.</p>

          <form onSubmit={handleUnlock} className={styles.lockForm}>
            <label className={styles.lockLabel}>
              keeper&rsquo;s word
              <input
                type="password"
                className={styles.lockInput}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="the secret password"
                autoFocus
              />
            </label>
            {unlockError && <p className={styles.lockError}>{unlockError}</p>}
            <button
              type="submit"
              className={styles.lockBtn}
              disabled={unlocking || !password}
            >
              {unlocking ? 'just a moment…' : 'Open the door'}
            </button>
          </form>

          <p className={styles.lockBackWrap}>
            <Link to="/map" className={styles.lockBack}>← back to the map</Link>
          </p>
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
              className={`${styles.tab} ${tab === 'accounts' ? styles.tabOn : ''}`}
              onClick={() => setTab('accounts')}
            >
              Accounts
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
      {tab === 'accounts'  && <AdminAccounts  password={password} />}
      {tab === 'analytics' && <AdminAnalytics password={password} />}
    </div>
  );
}

function AdminEditor({ password }) {
  const [configs, setConfigs] = useState(null);  // { [nodeId]: { shape_id, ops, range_min, range_max, ai_seconds } }
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
                <th title="Node number — position on the map, 1 through N">#</th>
                <th title="The map node being configured">Node</th>
                <th title="Which world this node belongs to">World</th>
                <th title="Which arithmetic operations appear in this node's battles (+, −, ×, ÷)">Ops</th>
                <th title="Range of numbers used to generate problems at this node (min to max)">Number range</th>
                <th title="Seconds the AI takes to answer each problem — lower is harder">AI sec</th>
                <th title="The battle grid shape used for this node">Shape</th>
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
                      <ShapePicker
                        value={cfg.shape_id}
                        onChange={shape_id => updateNode(node.id, { shape_id })}
                      />
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

function AdminAccounts({ password }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showAddAdult, setShowAddAdult] = useState(false);
  const [trialBusyId, setTrialBusyId] = useState(null);
  const { confirm, dialog } = useDialog();

  function reload() {
    return adminFetch('/api/admin/accounts', password)
      .then(setData)
      .catch(err => setError(err.message));
  }

  async function handleResetTrial(child) {
    const ok = await confirm({
      title: "Reset Dragon's Trial?",
      message: `${child.username} will be able to take the placement test again. Their map progress is preserved.`,
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setTrialBusyId(child.id);
    try {
      await adminFetch(`/api/admin/users/${child.id}/reset-trial`, password, { method: 'POST' });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrialBusyId(null);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.loading}>Loading…</p>;

  const { parents, children } = data;
  const parentCount  = parents.filter(p => (p.adult_role || 'parent') === 'parent').length;
  const teacherCount = parents.filter(p => p.adult_role === 'teacher').length;

  return (
    <div className={styles.analyticsWrap}>
      <Section title={`Adults — ${parentCount} parent${parentCount === 1 ? '' : 's'}, ${teacherCount} teacher${teacherCount === 1 ? '' : 's'}`}>
        <div className={styles.controls} style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className={styles.addBtnAligned}
            onClick={() => setShowAddAdult(v => !v)}
          >
            {showAddAdult ? 'Cancel' : '+ Add adult'}
          </button>
        </div>
        {showAddAdult && (
          <AddAdultForm
            password={password}
            onCancel={() => setShowAddAdult(false)}
            onCreated={async () => {
              await reload();
              setShowAddAdult(false);
            }}
          />
        )}
        {parents.length === 0 ? (
          <p className={styles.emptyMsg}>No adult accounts yet.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Email</th>
                <th>Kids</th>
                <th>Verified</th>
                <th>Weekly digest</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {parents.map(p => {
                const role = p.adult_role || 'parent';
                return (
                  <tr key={p.id}>
                    <td>
                      <span className={role === 'teacher' ? styles.roleBadgeTeacher : styles.roleBadgeParent}>
                        {role === 'teacher' ? '🍎 Teacher' : '👪 Parent'}
                      </span>
                    </td>
                    <td>{p.email || '—'}</td>
                    <td>{p.kid_count}</td>
                    <td>{p.email_verified ? '✓' : '—'}</td>
                    <td>{p.weekly_report_enabled ? '✓' : '—'}</td>
                    <td className={styles.timeCell}>{formatTimestamp(p.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Children (${children.length})`}>
        {children.length === 0 ? (
          <p className={styles.emptyMsg}>No child accounts yet.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Level</th>
                <th>Attempts</th>
                <th>Today (min)</th>
                <th>Trial</th>
                <th>Linked adults</th>
                <th>Last active</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {children.map(c => (
                <tr key={c.id}>
                  <td>
                    <span className={styles.nodeIcon}>{c.avatar}</span>
                    {c.username}
                  </td>
                  <td>{nodeShortLabel(c.current_node_id)}</td>
                  <td>{c.attempt_count}</td>
                  <td>{c.minutes_today}</td>
                  <td>
                    {c.dragon_trial_completed ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        ✓
                        <button
                          type="button"
                          onClick={() => handleResetTrial(c)}
                          disabled={trialBusyId === c.id}
                          className={styles.linkBtn}
                        >
                          {trialBusyId === c.id ? 'resetting…' : 'reset'}
                        </button>
                      </span>
                    ) : '—'}
                  </td>
                  <td>{c.parent_emails || '—'}</td>
                  <td className={styles.timeCell}>{formatTimestamp(c.last_attempt_at)}</td>
                  <td className={styles.timeCell}>{formatTimestamp(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {dialog}
    </div>
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

function formatScore(n) {
  if (n == null) return '—';
  return Number(n).toFixed(1);
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPromote, setShowPromote] = useState(false);

  async function reloadUsers() {
    const { users } = await adminFetch('/api/admin/users', password);
    setUsers(users);
    return users;
  }

  // Load user list once.
  useEffect(() => {
    reloadUsers()
      .then(users => {
        // Auto-select the user with the most attempts.
        if (users.length > 0 && !selectedUserId) {
          const top = [...users].sort((a, b) => (b.attempt_count || 0) - (a.attempt_count || 0))[0];
          setSelectedUserId(String(top.id));
        }
      })
      .catch(err => setUsersError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  async function handleUserCreated(newUser) {
    await reloadUsers();
    setSelectedUserId(String(newUser.id));
    setShowAddForm(false);
  }

  async function handlePromoted() {
    await reloadUsers();
    // Re-fetch analytics so any stat that depends on user state stays fresh.
    if (selectedUserId) {
      const qs = days > 0 ? `?days=${days}` : '';
      adminFetch(`/api/admin/analytics/${selectedUserId}${qs}`, password)
        .then(setData)
        .catch(() => { /* leave existing data, error surfaced elsewhere */ });
    }
    setShowPromote(false);
  }

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

  const selectedUser = users.find(u => String(u.id) === String(selectedUserId));

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
                {u.avatar} {u.username}
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
        <button
          type="button"
          className={styles.addBtnAligned}
          onClick={() => setShowAddForm(v => !v)}
        >
          {showAddForm ? 'Cancel' : '+ Add child'}
        </button>
      </div>

      {selectedUser && (
        <div className={styles.selectedChips}>
          <span className={styles.chip}>
            <span className={styles.chipLabel}>Attempts</span>
            <span className={styles.chipValue}>{selectedUser.attempt_count || 0}</span>
          </span>
          <span className={styles.chip}>
            <span className={styles.chipLabel}>Today</span>
            <span className={styles.chipValue}>{selectedUser.minutes_today || 0} min</span>
          </span>
          <span className={styles.chip}>
            <span className={styles.chipLabel}>Level</span>
            <span className={styles.chipValue}>
              {nodeShortLabel(selectedUser.current_node_id)}
            </span>
          </span>
          <button
            type="button"
            className={styles.addCancel}
            onClick={() => setShowPromote(v => !v)}
          >
            {showPromote ? 'Cancel' : 'Set level…'}
          </button>
        </div>
      )}

      {showAddForm && (
        <AddChildForm
          password={password}
          onCancel={() => setShowAddForm(false)}
          onCreated={handleUserCreated}
        />
      )}

      {showPromote && selectedUser && (
        <PromoteForm
          password={password}
          user={selectedUser}
          onCancel={() => setShowPromote(false)}
          onPromoted={handlePromoted}
        />
      )}

      {dataError && <p className={styles.error}>{dataError}</p>}
      {loadingData && <AnalyticsSkeleton />}

      {!loadingData && !dataError && !selectedUserId && (
        <EmptyAnalytics message="Pick a child above to see their progress." />
      )}
      {!loadingData && !dataError && selectedUserId && !data && (
        <EmptyAnalytics message="No data yet for this child." />
      )}

      {data && !loadingData && (
        <AnalyticsBody data={data} />
      )}
    </div>
  );
}

function EmptyAnalytics({ message }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIllustration} aria-hidden="true">
        <div className={styles.emptyBar} style={{ height: '38%' }} />
        <div className={styles.emptyBar} style={{ height: '62%' }} />
        <div className={styles.emptyBar} style={{ height: '48%' }} />
        <div className={styles.emptyBar} style={{ height: '78%' }} />
        <div className={styles.emptyBar} style={{ height: '54%' }} />
      </div>
      <p className={styles.emptyTitle}>{message}</p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className={styles.skeletonWrap} aria-label="Loading analytics">
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className={styles.skeletonCard} />
        ))}
      </div>
      <div className={styles.skeletonSection} />
      <div className={styles.skeletonSection} />
    </div>
  );
}

function AddChildForm({ password, onCancel, onCreated }) {
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { user } = await adminFetch('/api/admin/users', password, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim() }),
      });
      await onCreated(user);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <input
        type="text"
        className={styles.addInput}
        placeholder="Username (2–24 letters, numbers, _ or -)"
        value={username}
        onChange={e => setUsername(e.target.value)}
        autoFocus
        disabled={submitting}
      />
      <button
        type="submit"
        className={styles.addSubmit}
        disabled={submitting || !username.trim()}
      >
        {submitting ? 'Creating…' : 'Create'}
      </button>
      <button
        type="button"
        className={styles.addCancel}
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </button>
      {error && <span className={styles.errorInline}>{error}</span>}
    </form>
  );
}

function AddAdultForm({ password, onCancel, onCreated }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('parent');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await adminFetch('/api/admin/adults', password, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password: pw, role }),
      });
      await onCreated();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <select
        className={styles.sizeSelect}
        value={role}
        onChange={e => setRole(e.target.value)}
        disabled={submitting}
      >
        <option value="parent">Parent / guardian</option>
        <option value="teacher">Teacher</option>
      </select>
      <input
        type="email"
        className={styles.addInput}
        placeholder="email@example.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoFocus
        disabled={submitting}
      />
      <input
        type="text"
        className={styles.addInput}
        placeholder="Initial password (8+ chars)"
        value={pw}
        onChange={e => setPw(e.target.value)}
        disabled={submitting}
      />
      <button
        type="submit"
        className={styles.addSubmit}
        disabled={submitting || !email.trim() || pw.length < 8}
      >
        {submitting ? 'Creating…' : 'Create'}
      </button>
      <button
        type="button"
        className={styles.addCancel}
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </button>
      {error && <span className={styles.errorInline}>{error}</span>}
    </form>
  );
}

function nodeShortLabel(nodeId) {
  const node = MAP_NODES.find(n => n.id === nodeId);
  if (!node) return `#${nodeId}`;
  return `#${nodeId} ${node.icon} ${node.label}`;
}

function PromoteForm({ password, user, onCancel, onPromoted }) {
  const [nodeId, setNodeId] = useState(String(user.current_node_id || 1));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await adminFetch(`/api/admin/users/${user.id}/promote`, password, {
        method: 'POST',
        body: JSON.stringify({ node_id: Number(nodeId) }),
      });
      await onPromoted();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <label className={styles.controlLabel} style={{ flex: '1 1 260px' }}>
        Set {user.username}'s level to
        <select
          className={styles.sizeSelect}
          value={nodeId}
          onChange={e => setNodeId(e.target.value)}
          disabled={submitting}
        >
          {MAP_NODES.map(n => {
            const world = worldForNode(n.id);
            return (
              <option key={n.id} value={n.id}>
                #{n.id} — {n.icon} {n.label}
                {world ? ` (${world.name})` : ''}
                {n.type === NODE_TYPE.BOSS ? ' • BOSS' : ''}
              </option>
            );
          })}
        </select>
      </label>
      <button
        type="submit"
        className={styles.addSubmit}
        disabled={submitting || Number(nodeId) === user.current_node_id}
      >
        {submitting ? 'Setting…' : 'Set level'}
      </button>
      <button
        type="button"
        className={styles.addCancel}
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </button>
      {error && <span className={styles.errorInline}>{error}</span>}
    </form>
  );
}

function AnalyticsBody({ data }) {
  const {
    summary, byOperator, hardProblems, fastestProblems, confusions, recentAttempts,
    playtime, matches, byNodeMatches,
  } = data;
  const total = summary?.total || 0;
  const matchTotal = matches?.total || 0;

  if (total === 0 && !(playtime?.minutes_in_window > 0) && matchTotal === 0) {
    return <p className={styles.emptyMsg}>No attempts or playtime logged for this child in this window yet.</p>;
  }

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Minutes today"   value={playtime?.minutes_today || 0} />
        <StatCard label={`Minutes (last ${playtime?.window_days || 0}d)`} value={playtime?.minutes_in_window || 0} />
        <StatCard label="Problems answered" value={total} />
        <StatCard label="Child won"  value={summary.child_wins} sub={winPct(summary.child_wins, total)} accent="good" />
        <StatCard label="AI won"     value={summary.ai_wins}    sub={winPct(summary.ai_wins, total)}    accent="bad" />
        <StatCard label="Avg child time"  value={formatMs(summary.avg_child_ms)} />
        <StatCard label="Avg AI time"     value={formatMs(summary.avg_ai_ms)} />
      </div>

      <div className={styles.statGrid}>
        <StatCard label="Matches played"    value={matchTotal} />
        <StatCard label="Child won match"   value={matches?.child_wins || 0} sub={winPct(matches?.child_wins, matchTotal)} accent="good" />
        <StatCard label="AI won match"      value={matches?.ai_wins    || 0} sub={winPct(matches?.ai_wins,    matchTotal)} accent="bad"  />
        <StatCard label="Incomplete"        value={matches?.incomplete || 0} sub={winPct(matches?.incomplete, matchTotal)} />
      </div>

      <Section title="Daily playtime (battle minutes)">
        {playtime && playtime.by_day?.length > 0 ? (
          <DailyPlaytimeChart series={playtime.by_day} />
        ) : (
          <p className={styles.emptyMsg}>No playtime yet.</p>
        )}
      </Section>

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

      <Section title="Matches by node (with final scores)">
        {byNodeMatches?.length ? (
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Node</th><th>Matches</th><th>Child</th><th>AI</th><th>Incomplete</th>
                <th>Avg final score</th>
              </tr>
            </thead>
            <tbody>
              {byNodeMatches.map(row => {
                const node = MAP_NODES.find(n => n.id === row.node_id);
                const label = node ? `${node.icon} ${node.label}` : `#${row.node_id}`;
                return (
                  <tr key={row.node_id}>
                    <td>{label}</td>
                    <td>{row.matches}</td>
                    <td className={row.child_wins > 0 ? styles.goodCell : ''}>{row.child_wins}</td>
                    <td className={row.ai_wins    > 0 ? styles.badCell  : ''}>{row.ai_wins}</td>
                    <td>{row.incomplete}</td>
                    <td>{formatScore(row.avg_player_score)} – {formatScore(row.avg_ai_score)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className={styles.emptyMsg}>No matches logged yet.</p>
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

function DailyPlaytimeChart({ series }) {
  const max = Math.max(1, ...series.map(d => d.minutes));
  return (
    <div className={styles.playChart}>
      {series.map(d => {
        const pct = (d.minutes / max) * 100;
        return (
          <div key={d.day} className={styles.playBarCol} title={`${d.day}: ${d.minutes} min`}>
            <div className={styles.playBarTrack}>
              <div
                className={styles.playBarFill}
                style={{ height: `${Math.max(d.minutes > 0 ? 4 : 0, pct)}%` }}
              />
            </div>
            <div className={styles.playBarValue}>{d.minutes || ''}</div>
            <div className={styles.playBarLabel}>{formatDayShort(d.day)}</div>
          </div>
        );
      })}
    </div>
  );
}

function formatDayShort(iso) {
  // iso: 'YYYY-MM-DD' (local). Parse as local by appending T00:00.
  const d = new Date(`${iso}T00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
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

function ShapePicker({ value, onChange }) {
  const current = SHAPE_OPTIONS.find(s => s.id === value);
  return (
    <div className={styles.shapePicker}>
      <select
        className={styles.sizeSelect}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      >
        {!current && <option value="">(none)</option>}
        {SHAPE_OPTIONS.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} — {s.cells} cells
          </option>
        ))}
      </select>
      {current && <ShapePreview shape={current} />}
    </div>
  );
}

function ShapePreview({ shape }) {
  const rows = shape.art.split('\n');
  return (
    <div
      className={styles.shapePreview}
      style={{
        gridTemplateColumns: `repeat(${shape.width}, 1fr)`,
        gridTemplateRows: `repeat(${shape.height}, 1fr)`,
      }}
      aria-label={`${shape.name} preview`}
    >
      {rows.flatMap((row, r) =>
        Array.from({ length: shape.width }, (_, c) => {
          const ch = c < row.length ? row[c] : '.';
          return (
            <span
              key={`${r}-${c}`}
              className={ch === 'X' ? styles.shapeCellOn : styles.shapeCellOff}
            />
          );
        })
      )}
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
