import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { WORLDS } from '../data/mapData';
import styles from '../styles/ParentDashboard.module.css';

function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

function formatLastActive(iso) {
  if (!iso) return 'No play yet';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

export function ParentDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { logout } = useAuth();
  const [children, setChildren] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const [{ children }, meData] = await Promise.all([
        api.get('/api/parent/children'),
        api.get('/api/parent/me'),
      ]);
      setChildren(children);
      setMe(meData.user);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleUnlink(childId, name) {
    if (!confirm(`Stop following ${name}? You can re-link anytime with a new code.`)) return;
    try {
      await api.delete(`/api/parent/children/${childId}`);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleToggleWeekly(enabled) {
    try {
      await api.patch('/api/parent/preferences', { weekly_report_enabled: enabled });
      setMe(prev => ({ ...prev, weekly_report_enabled: enabled }));
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>🌿 Grown-up dashboard</h1>
          <p className={styles.sub}>Signed in as {user?.email}</p>
        </div>
        <button className={styles.linkBtn} onClick={async () => { await logout(); navigate('/auth'); }}>
          Sign out
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Your dragon-mathletes</h2>
          <button className={styles.primaryBtn} onClick={() => setShowAdd(true)}>+ Add a child</button>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : children.length === 0 ? (
          <div className={styles.emptyCard}>
            <p>No kids linked yet.</p>
            <p className={styles.muted}>Ask your child to open their profile and tap “Show grown-up code,” then click “Add a child” above.</p>
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {children.map(c => {
              const world = worldForNode(c.current_node_id);
              return (
                <article key={c.id} className={styles.kidCard}>
                  <div className={styles.kidHeader}>
                    <span className={styles.kidAvatar}>{c.avatar}</span>
                    <div>
                      <div className={styles.kidName}>{c.username}</div>
                      <div className={styles.kidWorld}>
                        {world ? `${world.name} · Level ${c.current_node_id}` : `Level ${c.current_node_id}`}
                      </div>
                    </div>
                  </div>
                  <dl className={styles.kidStats}>
                    <div><dt>Today</dt><dd>{c.minutes_today} min</dd></div>
                    <div><dt>Last 7 days</dt><dd>{c.minutes_7d} min</dd></div>
                    <div><dt>Last active</dt><dd>{formatLastActive(c.last_attempt_at)}</dd></div>
                  </dl>
                  <div className={styles.kidActions}>
                    <Link className={styles.primaryBtn} to={`/parent/children/${c.id}`}>View stats</Link>
                    <button className={styles.linkBtn} onClick={() => handleUnlink(c.id, c.username)}>Unlink</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Weekly email digest</h2>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={!!me?.weekly_report_enabled}
            onChange={e => handleToggleWeekly(e.target.checked)}
          />
          <span>Email me a recap of {children.length === 1 ? "my child's" : "my kids'"} week every Monday</span>
        </label>
      </section>

      {showAdd && (
        <AddChildModal
          onClose={() => setShowAdd(false)}
          onLinked={() => { setShowAdd(false); refresh(); }}
        />
      )}
    </div>
  );
}

function AddChildModal({ onClose, onLinked }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/parent/children/link', {
        child_username: username.trim(),
        code: code.trim(),
      });
      onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>Link a child</h3>
        <p className={styles.muted}>
          Ask your child to open their profile and tap <strong>Show grown-up code</strong>. Type the 6-digit code below.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Child's username
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={styles.input}
              autoComplete="off"
              required
            />
          </label>
          <label className={styles.label}>
            6-digit code
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={styles.input}
              autoComplete="off"
              required
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primaryBtn} disabled={busy}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
