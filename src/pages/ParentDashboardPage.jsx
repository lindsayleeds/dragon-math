import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { WORLDS } from '../data/mapData';
import { useDialog } from '../components/ConfirmModal';
import styles from '../styles/ParentDashboard.module.css';

function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

function loginUrlFor(token) {
  return `${window.location.origin}/k/${token}`;
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
  const [linkChild, setLinkChild] = useState(null); // child whose QR we're showing
  const [error, setError] = useState(null);
  const { confirm, alert, dialog } = useDialog();

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
    const ok = await confirm({
      title: `Unlink ${name}?`,
      message: `Stop following ${name}? You can re-link anytime with a new code.`,
      confirmLabel: 'Unlink',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/parent/children/${childId}`);
      refresh();
    } catch (err) {
      alert({ title: 'Could not unlink', message: err.message });
    }
  }

  async function handleToggleWeekly(enabled) {
    try {
      await api.patch('/api/parent/preferences', { weekly_report_enabled: enabled });
      setMe(prev => ({ ...prev, weekly_report_enabled: enabled }));
    } catch (err) {
      alert({ title: 'Could not update preference', message: err.message });
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Grown-up field notes</h1>
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
            <p>No travelers yet.</p>
            <p className={styles.muted}>Tap “Add a child” to create an account and get a QR code your child can scan to jump straight in — no password needed.</p>
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
                      <div className={styles.kidName}>{c.needs_handle ? 'New traveler' : c.username}</div>
                      {c.needs_handle ? (
                        <span className={styles.waitingBadge}>Waiting to set up</span>
                      ) : (
                        <div className={styles.kidWorld}>
                          {world ? `${world.name} · Level ${c.current_node_id}` : `Level ${c.current_node_id}`}
                        </div>
                      )}
                    </div>
                  </div>

                  {c.needs_handle ? (
                    <p className={styles.muted}>
                      Have your child scan their dragon link to pick a name and start playing.
                    </p>
                  ) : (
                    <dl className={styles.kidStats}>
                      <div><dt>Today</dt><dd>{c.minutes_today} min</dd></div>
                      <div><dt>Last 7 days</dt><dd>{c.minutes_7d} min</dd></div>
                      <div><dt>Last active</dt><dd>{formatLastActive(c.last_attempt_at)}</dd></div>
                    </dl>
                  )}

                  <div className={styles.kidActions}>
                    {c.needs_handle ? (
                      c.login_token && (
                        <button className={styles.primaryBtn} onClick={() => setLinkChild(c)}>Show dragon link</button>
                      )
                    ) : (
                      <Link className={styles.primaryBtn} to={`/parent/children/${c.id}`}>View stats</Link>
                    )}
                    {c.login_token && !c.needs_handle && (
                      <button className={styles.linkBtn} onClick={() => setLinkChild(c)}>Login link</button>
                    )}
                    <button className={styles.linkBtn} onClick={() => handleUnlink(c.id, c.needs_handle ? 'this traveler' : c.username)}>Unlink</button>
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
          onCreated={(child) => { refresh(); setShowAdd(false); setLinkChild(child); }}
        />
      )}
      {linkChild && (
        <LoginLinkModal child={linkChild} onClose={() => setLinkChild(null)} />
      )}
      {dialog}
    </div>
  );
}

// Shows a child's permanent "login by URL" as a scannable QR + copyable link.
function LoginLinkModal({ child, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = loginUrlFor(child.login_token);
  const name = child.needs_handle ? 'your new traveler' : child.username;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>{child.needs_handle ? 'Scan to start' : 'Dragon login link'}</h3>
        <p className={styles.muted}>
          {child.needs_handle
            ? `Have ${name} scan this with a phone or tablet camera. They’ll pick their own name and jump in — no password.`
            : `${name} can scan or bookmark this to sign in anytime — no password.`}
        </p>

        <div className={`${styles.qrPanel} ${styles.qrPrintArea}`}>
          <div className={styles.qrBox}>
            <QRCodeSVG value={url} size={200} level="M" includeMargin />
          </div>
          <div className={styles.qrUrl}>{url}</div>
        </div>

        <div className={styles.qrActions}>
          <button className={styles.primaryBtn} onClick={() => window.print()}>Print</button>
          <button className={styles.linkBtn} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy link'}</button>
        </div>
      </div>
    </div>
  );
}

function AddChildModal({ onClose, onLinked, onCreated }) {
  const [tab, setTab] = useState('create'); // 'create' | 'link'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // "Link existing" fields
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const { child } = await api.post('/api/parent/children', {});
      onCreated(child);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleLink(e) {
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
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>Add a child</h3>

        <div className={styles.tabRow}>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === 'create' ? styles.tabBtnActive : ''}`}
            onClick={() => { setTab('create'); setError(null); }}
          >
            New account
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === 'link' ? styles.tabBtnActive : ''}`}
            onClick={() => { setTab('link'); setError(null); }}
          >
            Have a code?
          </button>
        </div>

        {tab === 'create' ? (
          <>
            <p className={styles.muted}>
              Create a new account for your child. You’ll get a QR code they can scan to
              pick their own name and start playing — no password to remember.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.qrActions} style={{ marginTop: 16 }}>
              <button className={styles.primaryBtn} onClick={handleCreate} disabled={busy}>
                {busy ? 'Creating…' : 'Create & get QR code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.muted}>
              Already has their own account? Ask them to open their profile and tap
              <strong> Show grown-up code</strong>, then enter it here.
            </p>
            <form onSubmit={handleLink} className={styles.form}>
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
          </>
        )}
      </div>
    </div>
  );
}
