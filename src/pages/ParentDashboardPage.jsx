import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { WORLDS } from '../data/mapData';
import { useDialog } from '../components/ConfirmModal';
import styles from '../styles/ParentDashboard.module.css';
import { renderAvatar } from '../utils/avatar';

const PLAN_LABELS = { free: 'Free', premium: 'Premium', classroom: 'Classroom' };

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
  const { user, enterTestMode } = useAuthContext();
  const { logout } = useAuth();
  const [children, setChildren] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
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
      setMe({
        ...meData.user,
        kid_count: meData.kid_count,
        child_limit: meData.child_limit,
        can_add_child: meData.can_add_child,
        can_use_digest: meData.can_use_digest,
        can_manage_billing: meData.can_manage_billing,
        plan_status: meData.plan_status,
        plan_renews_at: meData.plan_renews_at,
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const plan = me?.plan || 'free';
  const canAddChild = me?.can_add_child !== false; // default allow until loaded
  const canUseDigest = !!me?.can_use_digest;
  const overLimit =
    me && me.child_limit != null && me.kid_count != null && me.kid_count > me.child_limit;

  // Open the add-child modal, or the upgrade prompt if the plan limit is hit.
  function handleAddChild() {
    if (me && !canAddChild) setShowUpgrade(true);
    else setShowAdd(true);
  }

  // Kick off Stripe Checkout for a paid plan, then redirect to the hosted page.
  async function handleCheckout(planKey, interval) {
    const { url } = await api.post('/api/billing/checkout', { plan: planKey, interval });
    window.location.href = url;
  }

  // Open the Stripe Customer Portal (change plan / update card / cancel).
  async function handleManageBilling() {
    try {
      const { url } = await api.post('/api/billing/portal', {});
      window.location.href = url;
    } catch (err) {
      alert({ title: 'Could not open billing', message: err.message });
    }
  }

  useEffect(() => { refresh(); }, []);

  // Returning from Stripe Checkout: show a notice and re-fetch once more shortly
  // after, since the plan flips via webhook (async, usually near-instant).
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;
    setCheckoutNotice(status);
    window.history.replaceState({}, '', '/parent');
    if (status === 'success') {
      const t = setTimeout(() => refresh(), 2500);
      return () => clearTimeout(t);
    }
  }, []);

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
          <p className={styles.sub}>
            Signed in as {user?.email}
            {me && (
              <>
                {' · '}
                <span className={styles.planBadge} data-plan={plan}>{PLAN_LABELS[plan] || 'Free'} plan</span>
                {plan === 'free' && (
                  <button className={styles.upgradeLink} onClick={() => setShowUpgrade(true)}>Upgrade</button>
                )}
              </>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.linkBtn} onClick={() => { enterTestMode(); navigate('/home'); }}>
            🎮 Test the games
          </button>
          {me?.can_manage_billing && (
            <button className={styles.linkBtn} onClick={handleManageBilling}>
              Manage billing
            </button>
          )}
          <button className={styles.linkBtn} onClick={async () => { await logout(); navigate('/auth'); }}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {checkoutNotice === 'success' && (
        <div className={styles.checkoutNotice}>
          🎉 Thanks! Your plan is being activated — it’ll appear here in a moment.
          <button className={styles.upgradeLink} onClick={() => setCheckoutNotice(null)}>Dismiss</button>
        </div>
      )}
      {checkoutNotice === 'cancel' && (
        <div className={styles.checkoutNotice}>
          No worries — checkout was cancelled and you weren’t charged.
          <button className={styles.upgradeLink} onClick={() => setCheckoutNotice(null)}>Dismiss</button>
        </div>
      )}

      {overLimit && (
        <div className={styles.overLimitBanner}>
          You have {me.kid_count} children but your {PLAN_LABELS[plan] || 'current'} plan covers{' '}
          {me.child_limit}. Nothing was lost — everyone can still play — but you'll need to
          upgrade to add more.{' '}
          <button className={styles.upgradeLink} onClick={() => setShowUpgrade(true)}>Upgrade</button>
        </div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Your dragon-mathletes</h2>
          <button className={styles.primaryBtn} onClick={handleAddChild}>+ Add a child</button>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : children.length === 0 ? (
          <div className={styles.emptyCard}>
            <p className={styles.emptyLead}>No travelers yet — here’s the trail to add one:</p>
            <ol className={styles.steps}>
              <li className={styles.step}>
                <span className={styles.stepNum} data-step="1">1</span>
                <div className={styles.stepBody}>
                  <span className={styles.stepTitle}>Tap “Add a child”</span>
                  <p className={styles.stepText}>We make their account and a QR code right away — no password to invent.</p>
                </div>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum} data-step="2">2</span>
                <div className={styles.stepBody}>
                  <span className={styles.stepTitle}>They scan the QR code</span>
                  <p className={styles.stepText}>Point any phone or tablet camera at it to jump straight in.</p>
                </div>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum} data-step="3">3</span>
                <div className={styles.stepBody}>
                  <span className={styles.stepTitle}>Pick a dragon name &amp; play</span>
                  <p className={styles.stepText}>They choose their own name and set off on the first math quest.</p>
                </div>
              </li>
            </ol>
            <button className={styles.primaryBtn} onClick={handleAddChild}>+ Add your first child</button>
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {children.map(c => {
              const world = worldForNode(c.current_node_id);
              return (
                <article key={c.id} className={styles.kidCard}>
                  <div className={styles.kidHeader}>
                    <span className={styles.kidAvatar}>{renderAvatar(c.avatar)}</span>
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
        {me && !canUseDigest ? (
          <div className={styles.lockedRow}>
            <span className={styles.lockedText}>
              🔒 Get a recap of {children.length === 1 ? "your child's" : "your kids'"} week every Monday
              — a Premium feature.
            </span>
            <button className={styles.upgradeBtn} onClick={() => setShowUpgrade(true)}>Upgrade to Premium</button>
          </div>
        ) : (
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={!!me?.weekly_report_enabled}
              onChange={e => handleToggleWeekly(e.target.checked)}
            />
            <span>Email me a recap of {children.length === 1 ? "my child's" : "my kids'"} week every Monday</span>
          </label>
        )}
      </section>

      {showAdd && (
        <AddChildModal
          onClose={() => setShowAdd(false)}
          onLinked={() => { setShowAdd(false); refresh(); }}
          onCreated={(child) => { refresh(); setShowAdd(false); setLinkChild(child); }}
          onLimitReached={() => { setShowAdd(false); setShowUpgrade(true); }}
        />
      )}
      {showUpgrade && (
        <UpgradeModal plan={plan} onClose={() => setShowUpgrade(false)} onCheckout={handleCheckout} />
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

// Upgrade prompt with live Stripe Checkout. `onCheckout(plan, interval)` starts a
// hosted Checkout session and redirects. If billing isn't configured yet the
// server replies 503 and we show a friendly "coming soon" note instead.
function UpgradeModal({ plan, onClose, onCheckout }) {
  const [busy, setBusy] = useState(null); // `${plan}:${interval}` while redirecting
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false); // reveal Classroom & yearly options

  async function pick(planKey, interval) {
    setBusy(`${planKey}:${interval}`);
    setError(null);
    try {
      await onCheckout(planKey, interval); // navigates away on success
    } catch (err) {
      setError(
        err.status === 503
          ? "Online payments aren't switched on yet — reply to any Dragon Math email and we'll set you up."
          : err.message,
      );
      setBusy(null);
    }
  }

  // The one-tap primary upgrade: Free → Premium, Premium → Classroom.
  const primaryKey = plan === 'premium' ? 'classroom' : 'premium';
  const primaryLabel = `Upgrade to ${PLAN_LABELS[primaryKey]}`;

  const tiers = [
    { key: 'premium', label: 'Premium', blurb: 'up to 9 children · weekly digest · Dragon Munchers' },
    { key: 'classroom', label: 'Classroom', blurb: '10+ children for teachers & big families · everything in Premium' },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>Unlock more of Dragon Math</h3>
        <p className={styles.muted}>
          You're on the <strong>{PLAN_LABELS[plan] || 'Free'}</strong> plan. Upgrade to add
          more young adventurers and unlock extra features.
        </p>

        <ul className={styles.planList}>
          <li><strong>Free</strong> — 1 child, core math games</li>
          <li><strong>Premium</strong> — up to 9 children · weekly digest · Dragon Munchers</li>
          <li><strong>Classroom</strong> — 10+ children for teachers &amp; big families · everything in Premium</li>
        </ul>

        <button
          className={styles.upgradeBtnPrimary}
          disabled={!!busy}
          onClick={() => pick(primaryKey, 'month')}
        >
          {busy === `${primaryKey}:month` ? 'Redirecting…' : primaryLabel}
        </button>

        {!showAll ? (
          <button className={styles.upgradeLink} onClick={() => setShowAll(true)}>
            See Classroom &amp; yearly plans
          </button>
        ) : (
          <>
            {tiers.map(t => (
              <div key={t.key} className={styles.planCard} data-current={plan === t.key || undefined}>
                <div className={styles.planCardHead}>
                  <strong>{t.label}</strong>
                  {plan === t.key && <span className={styles.planBadge} data-plan={t.key}>Current</span>}
                </div>
                <p className={styles.planCardBlurb}>{t.blurb}</p>
                <div className={styles.planCardBtns}>
                  <button
                    className={styles.upgradeBtn}
                    disabled={!!busy}
                    onClick={() => pick(t.key, 'month')}
                  >
                    {busy === `${t.key}:month` ? 'Redirecting…' : 'Monthly'}
                  </button>
                  <button
                    className={styles.upgradeBtn}
                    disabled={!!busy}
                    onClick={() => pick(t.key, 'year')}
                  >
                    {busy === `${t.key}:year` ? 'Redirecting…' : 'Yearly'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.muted} style={{ marginTop: 12 }}>
          Secure checkout is handled by Stripe. Cancel anytime from “Manage billing”.
        </p>
      </div>
    </div>
  );
}

function AddChildModal({ onClose, onLinked, onCreated, onLimitReached }) {
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
      if (err.code === 'child_limit') { onLimitReached(); return; }
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
      if (err.code === 'child_limit') { onLimitReached(); return; }
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
