import { useEffect, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { MAP_NODES, WORLDS, NODE_TYPE } from '../data/mapData';
import { BATTLE_SHAPES_LIST } from '../data/battleShapes';
import { SPELLING_WORDS, SPELLING_GRADES, audioFileFor } from '../data/spellingWords';
import { RARITIES, DEFAULT_RARITY, rarityMeta, dragonImage } from '../data/dragonRarity';
import { useDialog } from '../hooks/useDialog';
import { LoginLinkModal } from '../components/LoginLinkModal';
import { WelcomeEmailModal } from '../components/WelcomeEmailModal';
import styles from '../styles/AdminPage.module.css';
import { renderAvatar, isImageAvatar } from '../utils/avatar';

const BASE_URL = '';
// Shapes sorted small → large so World 1's 5-cell shapes cluster at the top
// and bosses' big shapes fall to the bottom — the option list reads like the
// natural difficulty ramp.
const SHAPE_OPTIONS = [...BATTLE_SHAPES_LIST].sort((a, b) => a.cells - b.cells);
const OPS = [
  { value: 'add', label: '+' },
  { value: 'sub', label: '−' },
  { value: 'mul', label: '×' },
  { value: 'div', label: '÷' },
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
            <Link to="/home" className={styles.lockBack}>⌂ home</Link>
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
        <h1 className={styles.title}>Admin</h1>
        <Link to="/home" className={styles.headerBack}>⌂ home</Link>
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
            className={`${styles.tab} ${tab === 'schools' ? styles.tabOn : ''}`}
            onClick={() => setTab('schools')}
          >
            Schools
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'analytics' ? styles.tabOn : ''}`}
            onClick={() => setTab('analytics')}
          >
            Analytics
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'dragons' ? styles.tabOn : ''}`}
            onClick={() => setTab('dragons')}
          >
            Dragons
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'spelling' ? styles.tabOn : ''}`}
            onClick={() => setTab('spelling')}
          >
            Spelling audio
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'email' ? styles.tabOn : ''}`}
            onClick={() => setTab('email')}
          >
            Email log
          </button>
        </div>
      </header>
      {tab === 'config'    && <AdminEditor    password={password} />}
      {tab === 'accounts'  && <AdminAccounts  password={password} />}
      {tab === 'schools'   && <AdminSchools   password={password} />}
      {tab === 'analytics' && <AdminAnalytics password={password} />}
      {tab === 'dragons'   && <AdminDragons   password={password} />}
      {tab === 'spelling'  && <AdminSpelling />}
      {tab === 'email'     && <AdminEmailLog  password={password} />}
    </div>
  );
}

// Weekly-digest send log — reads /api/admin/email-log so digest delivery
// failures are visible without DB/log spelunking. (Invite-email failures show
// in the invite receipt modal instead.)
function AdminEmailLog({ password }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function reload() {
    setError('');
    return adminFetch('/api/admin/email-log', password)
      .then(setData)
      .catch(err => setError(err.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const rows = data?.log || [];

  return (
    <Section title="Weekly digest email log">
      <p className={styles.emptyMsg} style={{ marginTop: 0 }}>
        The last 200 weekly-parent-digest send attempts, newest first.{' '}
        <strong>failed</strong> = the send threw (reason in the Error column);{' '}
        <strong>stubbed</strong> = logged to stdout, not delivered (EMAIL_STUB / no key).
        {' '}Invite-email failures aren’t here — those appear in the invite modal when you add an admin.
        <button type="button" className={styles.linkBtn} style={{ marginLeft: 8 }} onClick={reload}>refresh</button>
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {data && data.failed_count > 0 && (
        <p className={styles.error}>⚠️ {data.failed_count} failed send{data.failed_count === 1 ? '' : 's'} in the last 200 attempts.</p>
      )}
      {data == null ? (
        <p className={styles.loading}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.emptyMsg}>No digest emails sent yet.</p>
      ) : (
        <table className={styles.subTable}>
          <thead>
            <tr>
              <th>Parent</th>
              <th>Period</th>
              <th>Status</th>
              <th>Sent at</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.parent_email || <span className={styles.emptyMsg}>(deleted)</span>}</td>
                <td className={styles.timeCell}>{r.period_start} → {r.period_end}</td>
                <td>
                  <span style={{
                    fontWeight: 600,
                    color: r.status === 'failed' ? '#c0392b'
                      : r.status === 'sent' ? '#2f8f5b'
                      : '#7c7266',
                  }}>
                    {r.status}
                  </span>
                </td>
                <td className={styles.timeCell}>{r.sent_at ? formatTimestamp(r.sent_at) : '—'}</td>
                <td style={{ color: '#c0392b', fontSize: 13, wordBreak: 'break-word' }}>{r.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
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

// Kids who haven't picked a handle yet have their (UUID) login token seeded as
// a placeholder username — show something friendly instead of the raw GUID.
function childLabel(child) {
  if (child.adult_role) return child.email || child.username || 'this account';
  return child.needs_handle ? 'New adventurer' : child.username;
}

// Headless data table (TanStack) shared by the Parents / Teachers / Children
// rosters. Renders with the existing .subTable look, and adds click-to-sort
// column headers, drag-to-resize column borders, and a sticky header that
// stays put while the body scrolls. Cell content (buttons, selects, pills)
// lives in each caller's column defs, so the interactive bits are unchanged.
function DataTable({ columns, data, initialSorting }) {
  const [sorting, setSorting] = useState(initialSorting || []);
  // TanStack's useReactTable is opaque to the React Compiler, so it reports
  // "Compilation Skipped: Use of incompatible library" here. That means this one
  // component isn't auto-memoised — not that anything is wrong — and only the
  // library can fix it. /admin is a low-traffic operator page, so the lost
  // memoisation doesn't matter.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
  });
  return (
    <div className={styles.dataTableScroll}>
      <table className={styles.dataTable} style={{ width: table.getCenterTotalSize() }}>
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id}>
              {hg.headers.map(header => {
                const col = header.column;
                const canSort = col.getCanSort();
                const sorted = col.getIsSorted();
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={col.columnDef.meta?.thClassName}
                  >
                    {header.isPlaceholder ? null : (
                      <span
                        className={canSort ? styles.thSortable : undefined}
                        onClick={canSort ? col.getToggleSortingHandler() : undefined}
                      >
                        {flexRender(col.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className={styles.sortArrow} aria-hidden="true">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                          </span>
                        )}
                      </span>
                    )}
                    {col.getCanResize() && (
                      <span
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`${styles.resizer} ${col.getIsResizing() ? styles.resizerActive : ''}`}
                        aria-hidden="true"
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  style={{ width: cell.column.getSize() }}
                  className={cell.column.columnDef.meta?.className}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminAccounts({ password }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showAddAdult, setShowAddAdult] = useState(false);
  const [trialBusyId, setTrialBusyId] = useState(null);
  const [tokenBusyId, setTokenBusyId] = useState(null);
  const [planBusyId, setPlanBusyId] = useState(null);
  const [compBusyId, setCompBusyId] = useState(null);
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [linkChild, setLinkChild] = useState(null);
  const [rosterTeacher, setRosterTeacher] = useState(null);
  const [childrenParent, setChildrenParent] = useState(null);
  const [view, setView] = useState('parents');
  const [childFilter, setChildFilter] = useState('');
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

  // Manually set an adult's monetization plan (Phase-1 "billing").
  async function handleSetPlan(adult, plan) {
    setPlanBusyId(adult.id);
    try {
      await adminFetch(`/api/admin/users/${adult.id}/plan`, password, {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setPlanBusyId(null);
    }
  }

  // Grant or revoke a "lifetime free" comp. Granting uses the auto-by-role plan
  // (server picks premium for parents, classroom for teachers); the Plan
  // dropdown can still fine-tune the level afterwards without losing the comp.
  async function handleSetComp(adult, comped) {
    if (comped) {
      const ok = await confirm({
        title: 'Grant lifetime free?',
        message: `${adult.email || adult.username} will get a permanent free ${adult.adult_role === 'teacher' ? 'Classroom' : 'Premium'} plan that never bills and won't be downgraded by Stripe. You can remove it anytime.`,
        confirmLabel: 'Grant lifetime free',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: 'Remove lifetime free?',
        message: `${adult.email || adult.username} will drop back to the Free plan.`,
        confirmLabel: 'Remove comp',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setCompBusyId(adult.id);
    try {
      await adminFetch(`/api/admin/users/${adult.id}/comp`, password, {
        method: 'POST',
        body: JSON.stringify({ comped }),
      });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setCompBusyId(null);
    }
  }

  // Permanently delete an adult (parent/teacher). Linked children are kept —
  // only the parent/child links go — so a kid shared with another guardian
  // survives. This can't be undone, so it's a confirmed, danger-tone action.
  async function handleDeleteAdult(adult) {
    const who = adult.email || adult.username;
    const kidNote = adult.kid_count > 0
      ? ` Their ${adult.kid_count} linked ${adult.kid_count === 1 ? 'child' : 'children'} will be unlinked but not deleted.`
      : '';
    const ok = await confirm({
      title: `Delete this ${adult.adult_role === 'teacher' ? 'teacher' : 'parent'}?`,
      message: `${who} will be permanently deleted. This can't be undone.${kidNote}`,
      confirmLabel: 'Delete account',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleteBusyId(adult.id);
    try {
      await adminFetch(`/api/admin/adults/${adult.id}`, password, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleteBusyId(null);
    }
  }

  // Permanently delete a child account. Their progress, attempts, dragons, and
  // classroom/tribe/guardian links all go; this can't be undone, so it's a
  // confirmed, danger-tone action.
  async function handleDeleteChild(child) {
    const who = childLabel(child);
    const ok = await confirm({
      title: 'Delete this child?',
      message: `${who} and all their progress, dragons, and stats will be permanently deleted. This can't be undone.`,
      confirmLabel: 'Delete account',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleteBusyId(child.id);
    try {
      await adminFetch(`/api/admin/children/${child.id}`, password, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleteBusyId(null);
    }
  }

  // Open the QR/link modal for a child. Kids who have no token yet (legacy
  // accounts) get one minted on the spot; rotating an existing one is a
  // deliberate, confirmed action since it breaks any link already handed out.
  async function handleShowLink(child) {
    if (child.login_token) {
      setLinkChild(child);
      return;
    }
    setTokenBusyId(child.id);
    try {
      const { login_token } = await adminFetch(
        `/api/admin/users/${child.id}/login-token`, password, { method: 'POST' });
      await reload();
      setLinkChild({ ...child, login_token });
    } catch (err) {
      setError(err.message);
    } finally {
      setTokenBusyId(null);
    }
  }

  async function handleRotateLink(child) {
    const ok = await confirm({
      title: 'New login link?',
      message: `This makes a fresh link for ${childLabel(child)} and immediately stops the old one from working. Anyone holding the old link or QR code will need the new one.`,
      confirmLabel: 'Make new link',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setTokenBusyId(child.id);
    try {
      const { login_token } = await adminFetch(
        `/api/admin/users/${child.id}/login-token`, password, { method: 'POST' });
      await reload();
      setLinkChild({ ...child, login_token });
    } catch (err) {
      setError(err.message);
    } finally {
      setTokenBusyId(null);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.loading}>Loading…</p>;

  const { parents, children } = data;
  const parentAccts  = parents.filter(p => (p.adult_role || 'parent') === 'parent');
  const teacherAccts = parents.filter(p => p.adult_role === 'teacher');
  const parentCount  = parentAccts.length;
  const teacherCount = teacherAccts.length;

  // Per-audience accent lives on a CSS custom property so the switcher, count
  // badges, table header rule, and row hover all read as one color = one role.
  const VIEWS = [
    { key: 'parents',  label: 'Parents',  icon: '👪', count: parentCount,     onClass: styles.viewSegOnParent },
    { key: 'teachers', label: 'Teachers', icon: '🍎', count: teacherCount,    onClass: styles.viewSegOnTeacher },
    { key: 'children', label: 'Children', icon: '🧒', count: children.length, onClass: styles.viewSegOnChild },
  ];

  const paidParents    = parentAccts.filter(p => p.plan && p.plan !== 'free').length;
  const compedParents  = parentAccts.filter(p => p.comped).length;
  const paidTeachers   = teacherAccts.filter(p => p.plan && p.plan !== 'free').length;
  const compedTeachers = teacherAccts.filter(p => p.comped).length;

  const needle = childFilter.trim().toLowerCase();
  // Search filters the rows; the DataTable handles ordering (default sort is
  // Last active, most-recent first — see initialSorting below).
  const shownChildren = needle
    ? children.filter(c => childLabel(c).toLowerCase().includes(needle))
    : children;
  const activeChildren = children.filter(c => c.minutes_today > 0).length;
  const trialChildren  = children.filter(c => c.dragon_trial_completed).length;

  // Parents and teachers share a table; parents show a "Kids" (household-link)
  // count, teachers show a "Students" count that opens their classroom roster.
  // The Role column disappears now that each view holds a single role.
  function AdultRows(rows, kind, { kids = false, students = false } = {}) {
    if (rows.length === 0) {
      return <p className={styles.emptyMsg}>No {kind} accounts yet.</p>;
    }
    const columns = [
      {
        id: 'email',
        header: 'Email',
        accessorFn: p => p.email || '',
        size: 240,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <span className={styles.acctEmail} title={p.email || ''}>
              {p.email || <span className={styles.zero}>—</span>}
            </span>
          );
        },
      },
      ...(kids ? [{
        id: 'kids',
        header: 'Kids',
        accessorKey: 'kid_count',
        size: 80,
        meta: { className: styles.numCell, thClassName: styles.numCell },
        cell: ({ row }) => {
          const p = row.original;
          return p.kid_count > 0 ? (
            <button
              type="button"
              className={styles.countLink}
              onClick={() => setChildrenParent(p)}
              title="See this parent's children"
            >
              {p.kid_count}
            </button>
          ) : <span className={styles.zero}>0</span>;
        },
      }] : []),
      ...(students ? [{
        id: 'students',
        header: 'Students',
        accessorKey: 'student_count',
        size: 90,
        meta: { className: styles.numCell, thClassName: styles.numCell },
        cell: ({ row }) => {
          const p = row.original;
          return p.student_count > 0 ? (
            <button
              type="button"
              className={styles.countLink}
              onClick={() => setRosterTeacher(p)}
              title="See this teacher's students"
            >
              {p.student_count}
            </button>
          ) : <span className={styles.zero}>0</span>;
        },
      }] : []),
      {
        id: 'plan',
        header: 'Plan',
        accessorFn: p => p.plan || 'free',
        size: 130,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <select
              className={styles.miniSelect}
              value={p.plan || 'free'}
              disabled={planBusyId === p.id}
              onChange={e => handleSetPlan(p, e.target.value)}
            >
              <option value="free">Free</option>
              <option value="premium">Premium</option>
              <option value="classroom">Classroom</option>
            </select>
          );
        },
      },
      {
        id: 'comped',
        header: 'Lifetime free',
        accessorFn: p => p.comped ? 1 : 0,
        size: 130,
        cell: ({ row }) => {
          const p = row.original;
          return p.comped ? (
            <span className={styles.cellRow}>
              <span className={styles.compBadge} title="Permanent free plan — not billed by Stripe">
                ✨ Lifetime
              </span>
              <button
                type="button"
                className={styles.linkBtn}
                disabled={compBusyId === p.id}
                onClick={() => handleSetComp(p, false)}
              >
                {compBusyId === p.id ? 'working…' : 'remove'}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={styles.linkBtn}
              disabled={compBusyId === p.id}
              onClick={() => handleSetComp(p, true)}
              title="Grant a permanent free plan"
            >
              {compBusyId === p.id ? 'working…' : 'Grant'}
            </button>
          );
        },
      },
      {
        id: 'verified',
        header: 'Verified',
        accessorFn: p => p.email_verified ? 1 : 0,
        size: 90,
        cell: ({ row }) => row.original.email_verified
          ? <span className={styles.tickGood}>✓</span>
          : <span className={styles.zero}>—</span>,
      },
      {
        id: 'digest',
        header: 'Weekly digest',
        accessorFn: p => p.weekly_report_enabled ? 1 : 0,
        size: 120,
        cell: ({ row }) => row.original.weekly_report_enabled
          ? <span className={styles.tickGood}>✓</span>
          : <span className={styles.zero}>—</span>,
      },
      {
        id: 'login',
        header: 'Login link',
        enableSorting: false,
        size: 140,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <span className={styles.cellRow}>
              <button
                type="button"
                onClick={() => handleShowLink(p)}
                disabled={tokenBusyId === p.id}
                className={styles.linkBtn}
              >
                {tokenBusyId === p.id
                  ? 'working…'
                  : (p.login_token ? 'Show QR' : 'Generate')}
              </button>
              {p.login_token && (
                <button
                  type="button"
                  onClick={() => handleRotateLink(p)}
                  disabled={tokenBusyId === p.id}
                  className={styles.linkBtn}
                  title="Make a new link and disable the old one"
                >
                  new
                </button>
              )}
            </span>
          );
        },
      },
      {
        id: 'created',
        header: 'Signed up',
        accessorFn: p => p.created_at ? new Date(p.created_at).getTime() : undefined,
        sortUndefined: 'last',
        size: 150,
        meta: { className: styles.timeCell },
        cell: ({ row }) => formatTimestamp(row.original.created_at),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableResizing: false,
        size: 90,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <button
              type="button"
              className={styles.deleteBtn}
              disabled={deleteBusyId === p.id}
              onClick={() => handleDeleteAdult(p)}
              title="Permanently delete this account"
            >
              {deleteBusyId === p.id ? 'working…' : 'Delete'}
            </button>
          );
        },
      },
    ];
    return (
      <DataTable
        columns={columns}
        data={rows}
        initialSorting={[{ id: 'created', desc: true }]}
      />
    );
  }

  function ChildRows(rows) {
    const columns = [
      {
        id: 'child',
        header: 'Child',
        accessorFn: c => childLabel(c),
        size: 220,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <span className={styles.childCell}>
              <span className={styles.childAvatar} aria-hidden="true">{renderAvatar(c.avatar)}</span>
              <span className={styles.childName} title={childLabel(c)}>{childLabel(c)}</span>
            </span>
          );
        },
      },
      {
        id: 'level',
        header: 'Level',
        accessorFn: c => c.current_node_id ?? 0,
        size: 150,
        cell: ({ row }) => <LevelPill nodeId={row.original.current_node_id} />,
      },
      {
        id: 'attempts',
        header: 'Attempts',
        accessorKey: 'attempt_count',
        size: 100,
        meta: { className: styles.numCell, thClassName: styles.numCell },
        cell: ({ getValue }) => <Num value={getValue()} />,
      },
      {
        id: 'trial',
        header: 'Trial',
        accessorFn: c => c.dragon_trial_completed ? 1 : 0,
        size: 100,
        cell: ({ row }) => {
          const c = row.original;
          return c.dragon_trial_completed ? (
            <span className={styles.cellRow}>
              <span className={styles.tickGood} aria-hidden="true">✓</span>
              <button
                type="button"
                onClick={() => handleResetTrial(c)}
                disabled={trialBusyId === c.id}
                className={styles.linkBtn}
              >
                {trialBusyId === c.id ? 'resetting…' : 'reset'}
              </button>
            </span>
          ) : <span className={styles.zero}>—</span>;
        },
      },
      {
        id: 'login',
        header: 'Login link',
        enableSorting: false,
        size: 140,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <span className={styles.cellRow}>
              <button
                type="button"
                onClick={() => handleShowLink(c)}
                disabled={tokenBusyId === c.id}
                className={styles.linkBtn}
              >
                {tokenBusyId === c.id
                  ? 'working…'
                  : (c.login_token ? 'Show QR' : 'Generate')}
              </button>
              {c.login_token && (
                <button
                  type="button"
                  onClick={() => handleRotateLink(c)}
                  disabled={tokenBusyId === c.id}
                  className={styles.linkBtn}
                  title="Make a new link and disable the old one"
                >
                  new
                </button>
              )}
            </span>
          );
        },
      },
      {
        id: 'adults',
        header: 'Linked adults',
        accessorFn: c => c.parent_emails || '',
        size: 220,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <span className={styles.emailCell} title={c.parent_emails || ''}>
              {c.parent_emails || <span className={styles.zero}>—</span>}
            </span>
          );
        },
      },
      {
        id: 'last_active',
        header: 'Last active',
        accessorFn: c => c.last_attempt_at ? new Date(c.last_attempt_at).getTime() : undefined,
        sortUndefined: 'last',
        size: 160,
        meta: { className: styles.timeCell },
        cell: ({ row }) => formatTimestamp(row.original.last_attempt_at),
      },
      {
        id: 'created',
        header: 'Signed up',
        accessorFn: c => c.created_at ? new Date(c.created_at).getTime() : undefined,
        sortUndefined: 'last',
        size: 160,
        meta: { className: styles.timeCell },
        cell: ({ row }) => formatTimestamp(row.original.created_at),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableResizing: false,
        size: 90,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <button
              type="button"
              className={styles.deleteBtn}
              disabled={deleteBusyId === c.id}
              onClick={() => handleDeleteChild(c)}
              title="Permanently delete this account"
            >
              {deleteBusyId === c.id ? 'working…' : 'Delete'}
            </button>
          );
        },
      },
    ];
    return (
      <DataTable
        columns={columns}
        data={rows}
        initialSorting={[{ id: 'last_active', desc: true }]}
      />
    );
  }

  return (
    <div className={styles.accountsWrap}>
      <div className={styles.viewSwitch} role="tablist" aria-label="Account view">
        {VIEWS.map(v => {
          const on = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={on}
              className={`${styles.viewSeg} ${on ? v.onClass : ''}`}
              onClick={() => setView(v.key)}
            >
              <span className={styles.viewSegIcon} aria-hidden>{v.icon}</span>
              {v.label}
              <span className={styles.viewSegCount}>{v.count}</span>
            </button>
          );
        })}
      </div>

      {view === 'parents' && (
        <>
          <Section
            className={`${styles.roster} ${styles.rosterParent}`}
            title={`Parents & guardians · ${parentCount}`}
            action={
              <button
                type="button"
                className={styles.addBtnAligned}
                onClick={() => setShowAddAdult(v => !v)}
              >
                {showAddAdult ? 'Cancel' : '+ Add parent'}
              </button>
            }
          >
            <div className={styles.rosterStats}>
              <span className={styles.chip}><span className={styles.chipLabel}>On a paid plan</span><span className={styles.chipValue}>{paidParents}</span></span>
              <span className={styles.chip}><span className={styles.chipLabel}>Lifetime-free</span><span className={styles.chipValue}>{compedParents}</span></span>
            </div>
            {showAddAdult && (
              <AddAdultForm
                password={password}
                initialRole="parent"
                onCancel={() => setShowAddAdult(false)}
                onCreated={async () => {
                  await reload();
                  setShowAddAdult(false);
                }}
              />
            )}
            {AdultRows(parentAccts, 'parent', { kids: true })}
          </Section>
          <CompInvites key="parents" password={password} defaultRole="parent" />
        </>
      )}

      {view === 'teachers' && (
        <>
          <Section
            className={`${styles.roster} ${styles.rosterTeacher}`}
            title={`Teachers · ${teacherCount}`}
            action={
              <button
                type="button"
                className={styles.addBtnAligned}
                onClick={() => setShowAddAdult(v => !v)}
              >
                {showAddAdult ? 'Cancel' : '+ Add teacher'}
              </button>
            }
          >
            <div className={styles.rosterStats}>
              <span className={styles.chip}><span className={styles.chipLabel}>On a paid plan</span><span className={styles.chipValue}>{paidTeachers}</span></span>
              <span className={styles.chip}><span className={styles.chipLabel}>Lifetime-free</span><span className={styles.chipValue}>{compedTeachers}</span></span>
            </div>
            {showAddAdult && (
              <AddAdultForm
                password={password}
                initialRole="teacher"
                onCancel={() => setShowAddAdult(false)}
                onCreated={async () => {
                  await reload();
                  setShowAddAdult(false);
                }}
              />
            )}
            {AdultRows(teacherAccts, 'teacher', { students: true })}
          </Section>
          <CompInvites key="teachers" password={password} defaultRole="teacher" />
        </>
      )}

      {view === 'children' && (
      <Section
        className={`${styles.roster} ${styles.rosterChild}`}
        title={`Children · ${needle ? `${shownChildren.length} of ${children.length}` : children.length}`}
      >
        <div className={styles.rosterStats}>
          <span className={styles.chip}><span className={styles.chipLabel}>Active today</span><span className={styles.chipValue}>{activeChildren}</span></span>
          <span className={styles.chip}><span className={styles.chipLabel}>Finished the trial</span><span className={styles.chipValue}>{trialChildren}</span></span>
        </div>
        {children.length > 0 && (
          <input
            type="search"
            className={styles.acctSearch}
            placeholder="Search children by name…"
            value={childFilter}
            onChange={e => setChildFilter(e.target.value)}
          />
        )}
        {children.length === 0 ? (
          <p className={styles.emptyMsg}>No child accounts yet.</p>
        ) : shownChildren.length === 0 ? (
          <p className={styles.emptyMsg}>No children match &ldquo;{childFilter.trim()}&rdquo;.</p>
        ) : (
          ChildRows(shownChildren)
        )}
      </Section>
      )}
      {rosterTeacher && (
        <TeacherRosterModal
          teacher={rosterTeacher}
          password={password}
          onClose={() => setRosterTeacher(null)}
          onShowLink={handleShowLink}
        />
      )}
      {childrenParent && (
        <ParentChildrenModal
          parent={childrenParent}
          password={password}
          onClose={() => setChildrenParent(null)}
          onShowLink={handleShowLink}
        />
      )}
      {linkChild && (
        <LoginLinkModal child={linkChild} onClose={() => setLinkChild(null)} />
      )}
      {dialog}
    </div>
  );
}

// Admin peek at one teacher's roster, grouped by classroom. Opened from the
// "Students" count in the Teachers table. Read-only apart from the per-student
// login-link shortcut, which reuses the accounts page's QR modal.
function TeacherRosterModal({ teacher, password, onClose, onShowLink }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/api/admin/teachers/${teacher.id}/students`, password)
      .then(setData)
      .catch(err => setError(err.message));
  }, [teacher.id, password]);

  const rooms = data?.classrooms || [];
  const totalStudents = data
    ? new Set(rooms.flatMap(r => r.students.map(s => s.id))).size
    : null;

  return (
    <div className={styles.rosterOverlay} onClick={onClose}>
      <div className={styles.rosterModal} onClick={e => e.stopPropagation()}>
        <button className={styles.rosterClose} onClick={onClose} aria-label="Close">✕</button>
        <h3 className={styles.rosterModalTitle}>
          <span aria-hidden>🍎</span> {teacher.email || 'Teacher'}&rsquo;s students
        </h3>
        {totalStudents != null && (
          <p className={styles.rosterModalSub}>
            {totalStudents} student{totalStudents === 1 ? '' : 's'} across{' '}
            {rooms.length} class{rooms.length === 1 ? '' : 'es'}
          </p>
        )}

        {error && <p className={styles.error}>{error}</p>}
        {!data && !error && <p className={styles.loading}>Loading…</p>}
        {data && rooms.length === 0 && (
          <p className={styles.emptyMsg}>This teacher hasn&rsquo;t created any classrooms yet.</p>
        )}

        {rooms.map(room => (
          <div key={room.classroom_id} className={styles.rosterRoom}>
            <div className={styles.rosterRoomHead}>
              <span className={styles.rosterRoomName}>{room.classroom_name}</span>
              <span className={styles.rosterRoomMeta}>
                code <code>{room.join_code}</code> · {room.students.length} student{room.students.length === 1 ? '' : 's'}
              </span>
            </div>
            {room.students.length === 0 ? (
              <p className={styles.rosterRoomEmpty}>No students in this class yet.</p>
            ) : (
              <ul className={styles.rosterList}>
                {room.students.map(s => (
                  <li key={s.id} className={styles.rosterStudent}>
                    <span className={styles.childAvatar} aria-hidden>{renderAvatar(s.avatar)}</span>
                    <span className={styles.rosterStudentName}>
                      {s.real_name || childLabel(s)}
                      {s.real_name && !s.needs_handle && (
                        <span className={styles.rosterStudentHandle}>@{s.username}</span>
                      )}
                    </span>
                    <LevelPill nodeId={s.current_node_id} />
                    <span className={styles.rosterStudentSeen}>{formatTimestamp(s.last_attempt_at)}</span>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => onShowLink(s)}
                    >
                      {s.login_token ? 'Show QR' : 'Generate'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin peek at one parent's linked children (parent_child_links). Opened from
// the "Kids" count in the Parents table. Read-only apart from the per-child
// login-link shortcut, which reuses the accounts page's QR modal.
function ParentChildrenModal({ parent, password, onClose, onShowLink }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/api/admin/parents/${parent.id}/children`, password)
      .then(setData)
      .catch(err => setError(err.message));
  }, [parent.id, password]);

  const kids = data?.children || [];

  return (
    <div className={styles.rosterOverlay} onClick={onClose}>
      <div className={styles.rosterModal} onClick={e => e.stopPropagation()}>
        <button className={styles.rosterClose} onClick={onClose} aria-label="Close">✕</button>
        <h3 className={styles.rosterModalTitle}>
          <span aria-hidden>🐣</span> {parent.email || parent.username || 'Parent'}&rsquo;s children
        </h3>
        {data && (
          <p className={styles.rosterModalSub}>
            {kids.length} child{kids.length === 1 ? '' : 'ren'}
          </p>
        )}

        {error && <p className={styles.error}>{error}</p>}
        {!data && !error && <p className={styles.loading}>Loading…</p>}
        {data && kids.length === 0 && (
          <p className={styles.emptyMsg}>This parent has no children linked yet.</p>
        )}

        {kids.length > 0 && (
          <ul className={styles.rosterList}>
            {kids.map(s => (
              <li key={s.id} className={styles.rosterStudent}>
                <span className={styles.childAvatar} aria-hidden>{renderAvatar(s.avatar)}</span>
                <span className={styles.rosterStudentName}>
                  {s.real_name || childLabel(s)}
                  {s.real_name && !s.needs_handle && (
                    <span className={styles.rosterStudentHandle}>@{s.username}</span>
                  )}
                </span>
                <LevelPill nodeId={s.current_node_id} />
                <span className={styles.rosterStudentSeen}>{formatTimestamp(s.last_attempt_at)}</span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => onShowLink(s)}
                >
                  {s.login_token ? 'Show QR' : 'Generate'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Build the shareable signup URL for a comp invite token.
function compInviteUrl(token) {
  return `${window.location.origin}/parent?comp=${encodeURIComponent(token)}`;
}

// "Lifetime free" invite links: an admin mints a single-use link, shares it, and
// whoever signs up through it becomes a comped parent/teacher. See
// server/routes/admin.js (/comp-invites) + auth.js (redemption).
function CompInvites({ password, defaultRole = 'parent' }) {
  const [invites, setInvites] = useState(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState(defaultRole);
  const [planMode, setPlanMode] = useState('auto'); // 'auto' | 'premium' | 'classroom'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const { confirm, dialog } = useDialog();

  function reload() {
    return adminFetch('/api/admin/comp-invites', password)
      .then(d => setInvites(d.invites))
      .catch(err => setError(err.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { role, note: note.trim() };
      if (planMode !== 'auto') body.plan = planMode;
      await adminFetch('/api/admin/comp-invites', password, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNote('');
      setPlanMode('auto');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(invite) {
    try {
      await navigator.clipboard.writeText(compInviteUrl(invite.token));
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(c => (c === invite.id ? null : c)), 1500);
    } catch {
      setError('Could not copy — select and copy the link manually.');
    }
  }

  async function handleRevoke(invite) {
    const ok = await confirm({
      title: 'Revoke this invite?',
      message: 'The link will stop working immediately. Already-redeemed invites are unaffected.',
      confirmLabel: 'Revoke',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await adminFetch(`/api/admin/comp-invites/${invite.id}`, password, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  function inviteStatus(inv) {
    if (inv.redeemed_at) return { label: 'Redeemed', open: false };
    if (inv.revoked_at) return { label: 'Revoked', open: false };
    return { label: 'Open', open: true };
  }

  return (
    <Section title="Lifetime-free invites">
      <p className={styles.emptyMsg} style={{ marginTop: 0 }}>
        Mint a one-time link. Whoever signs up through it becomes a comped
        {' '}parent or teacher with a permanent free plan.
      </p>
      <form onSubmit={handleCreate} className={styles.controls} style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' }}>
        <select value={role} onChange={e => setRole(e.target.value)} disabled={busy}>
          <option value="parent">👪 Parent</option>
          <option value="teacher">🍎 Teacher</option>
        </select>
        <select value={planMode} onChange={e => setPlanMode(e.target.value)} disabled={busy} title="Plan to grant">
          <option value="auto">Plan: auto by role</option>
          <option value="premium">Plan: Premium</option>
          <option value="classroom">Plan: Classroom</option>
        </select>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. Ms. Garcia, Room 4"
          maxLength={200}
          disabled={busy}
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" className={styles.addBtnAligned} disabled={busy}>
          {busy ? 'Creating…' : '+ New invite link'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {invites == null ? (
        <p className={styles.loading}>Loading…</p>
      ) : invites.length === 0 ? (
        <p className={styles.emptyMsg}>No invites yet.</p>
      ) : (
        <table className={styles.subTable}>
          <thead>
            <tr>
              <th>Note</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Link</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {invites.map(inv => {
              const st = inviteStatus(inv);
              return (
                <tr key={inv.id}>
                  <td>{inv.note || '—'}</td>
                  <td>{inv.role === 'teacher' ? '🍎 Teacher' : '👪 Parent'}</td>
                  <td>{inv.plan ? (inv.plan === 'classroom' ? 'Classroom' : 'Premium') : 'auto'}</td>
                  <td>{st.label}</td>
                  <td>
                    {st.open ? (
                      <span className={styles.cellRow}>
                        <button type="button" className={styles.linkBtn} onClick={() => handleCopy(inv)}>
                          {copiedId === inv.id ? 'Copied!' : 'Copy link'}
                        </button>
                        <button type="button" className={styles.linkBtn} onClick={() => handleRevoke(inv)}>
                          revoke
                        </button>
                      </span>
                    ) : '—'}
                  </td>
                  <td className={styles.timeCell}>{formatTimestamp(inv.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {dialog}
    </Section>
  );
}

// Schools admin: mint a school (with its teacher join code), name its admins by
// email, and see teacher/student counts. Admins are any existing adult account;
// teachers attach themselves with the join code. See server/routes/admin.js
// (/schools) and server/routes/school.js for the admin/teacher-facing API.
function AdminSchools({ password }) {
  const [schools, setSchools] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [adminEmails, setAdminEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [notice, setNotice] = useState('');
  const [addAdminTo, setAddAdminTo] = useState(null); // school we're adding an admin to
  const [openSchool, setOpenSchool] = useState(null); // school we've drilled into
  const [welcomeReceipt, setWelcomeReceipt] = useState(null); // { receipts: [...], bcc }
  const { confirm, dialog } = useDialog();

  function reload() {
    return adminFetch('/api/admin/schools', password)
      .then(d => setSchools(d.schools))
      .catch(err => setError(err.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const admin_emails = adminEmails
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const res = await adminFetch('/api/admin/schools', password, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), admin_emails }),
      });
      setName('');
      setAdminEmails('');
      if (res.skipped?.length) {
        setNotice(`Skipped: ${res.skipped.map(s => `${s.email} (${s.reason})`).join(', ')}.`);
      }
      if (res.added?.length) {
        setWelcomeReceipt({ bcc: res.bcc, receipts: res.added });
      }
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyCode(school) {
    try {
      await navigator.clipboard.writeText(school.join_code);
      setCopiedId(school.id);
      setTimeout(() => setCopiedId(c => (c === school.id ? null : c)), 1500);
    } catch {
      setError('Could not copy — select and copy the code manually.');
    }
  }

  async function handleAddAdmin(school, email) {
    const res = await adminFetch(`/api/admin/schools/${school.id}/admins`, password, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    });
    setAddAdminTo(null);
    setWelcomeReceipt({
      bcc: res.bcc,
      receipts: [{
        email: res.admin?.email || email.trim(),
        created: res.created,
        login_link: res.login_link,
        email_sent: res.email_sent,
        email_error: res.email_error,
      }],
    });
    await reload();
  }

  async function handleDelete(school) {
    const ok = await confirm({
      title: `Delete ${school.name}?`,
      message: 'Removes the school and its admin/teacher links. Teacher and student accounts are untouched.',
      confirmLabel: 'Delete school',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await adminFetch(`/api/admin/schools/${school.id}`, password, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  // Drilled into one school — show the same admins/teachers/students view a
  // school admin sees on their own dashboard, loaded for the selected school.
  if (openSchool) {
    return (
      <AdminSchoolDetail
        school={openSchool}
        password={password}
        onBack={() => setOpenSchool(null)}
      />
    );
  }

  return (
    <Section title="Schools">
      <p className={styles.emptyMsg} style={{ marginTop: 0 }}>
        A school groups teachers so its admins can see every student in one place. Create the
        school, name its admin(s) by email, and share the join code with teachers.
      </p>
      <form onSubmit={handleCreate} className={styles.controls} style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' }}>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="School name — e.g. Maple Elementary"
          maxLength={120}
          disabled={busy}
          required
          style={{ flex: '1 1 220px' }}
        />
        <input
          type="text"
          value={adminEmails}
          onChange={e => setAdminEmails(e.target.value)}
          placeholder="Admin email(s), comma-separated (optional)"
          disabled={busy}
          style={{ flex: '1 1 260px' }}
        />
        <button type="submit" className={styles.addBtnAligned} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : '+ New school'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.emptyMsg}>{notice}</p>}

      {addAdminTo && (
        <AddAdminForm
          school={addAdminTo}
          onCancel={() => setAddAdminTo(null)}
          onSubmit={(email) => handleAddAdmin(addAdminTo, email)}
        />
      )}

      {schools == null ? (
        <p className={styles.loading}>Loading…</p>
      ) : schools.length === 0 ? (
        <p className={styles.emptyMsg}>No schools yet.</p>
      ) : (
        <table className={styles.subTable}>
          <thead>
            <tr>
              <th>School</th>
              <th>Join code</th>
              <th>Admins</th>
              <th>Teachers</th>
              <th>Students</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schools.map(s => (
              <tr key={s.id}>
                <td>
                  <button
                    type="button"
                    className={styles.countLink}
                    onClick={() => setOpenSchool(s)}
                    title={`Open ${s.name}'s dashboard`}
                  >
                    {s.name}
                  </button>
                </td>
                <td>
                  <span className={styles.cellRow}>
                    <code style={{ letterSpacing: '2px' }}>{s.join_code}</code>
                    <button type="button" className={styles.linkBtn} onClick={() => handleCopyCode(s)}>
                      {copiedId === s.id ? 'Copied!' : 'copy'}
                    </button>
                  </span>
                </td>
                <td>{s.admin_emails || <span className={styles.emptyMsg}>none</span>}</td>
                <td>{s.teacher_count}</td>
                <td>{s.student_count}</td>
                <td className={styles.timeCell}>{formatTimestamp(s.created_at)}</td>
                <td>
                  <span className={styles.cellRow}>
                    <button type="button" className={styles.linkBtn} onClick={() => setAddAdminTo(s)}>
                      + admin
                    </button>
                    <button type="button" className={styles.linkBtn} onClick={() => handleDelete(s)}>
                      delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {welcomeReceipt && (
        <WelcomeEmailModal
          receipts={welcomeReceipt.receipts}
          bcc={welcomeReceipt.bcc}
          onClose={() => setWelcomeReceipt(null)}
        />
      )}
      {dialog}
    </Section>
  );
}

// Super-admin drill-in for one school — the same admins / teachers / students
// view a school admin sees on their own dashboard (SchoolDashboardPage), but
// reached from the password-gated /admin panel and loaded for the *selected*
// school. It reads the admin-password-gated GET /api/admin/schools/:id and
// /students endpoints, which return the identical data shape as the school
// admin's own /api/school/:id endpoints (both share schoolDetail/schoolStudents
// in server/routes/school.js) — so no authorization check is widened: the
// operator is authorized by the admin password, not by school_admins membership.
// Read-only: management actions (add/remove admin, delete) stay on the list.
function fmtMinutes(m) {
  if (!m) return '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// 'YYYY-MM-DD HH:MM' (local) → "Jun 18" or "—" when never seen.
function fmtLastSeen(s) {
  if (!s) return '—';
  const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function AdminSchoolDetail({ school, password, onBack }) {
  const [detail, setDetail] = useState(null);   // { school, admins, teachers }
  const [students, setStudents] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('students');

  useEffect(() => {
    let live = true;
    setDetail(null);
    setStudents(null);
    setError('');
    Promise.all([
      adminFetch(`/api/admin/schools/${school.id}`, password),
      adminFetch(`/api/admin/schools/${school.id}/students`, password),
    ])
      .then(([detailRes, studentsRes]) => {
        if (!live) return;
        setDetail(detailRes);
        setStudents(studentsRes.students);
      })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [school.id, password]);

  // Prefer the freshly-loaded name/code; fall back to the list row while loading.
  const name = detail?.school?.name || school.name;
  const joinCode = detail?.school?.join_code || school.join_code;
  const admins = detail?.admins || [];
  const teachers = detail?.teachers || [];

  const VIEWS = [
    { key: 'admins',   label: '🛡️ Admins',   count: detail ? admins.length : null },
    { key: 'teachers', label: '🍎 Teachers', count: detail ? teachers.length : null },
    { key: 'students', label: '🎒 Students', count: students ? students.length : null },
  ];

  return (
    <Section title="School dashboard">
      <div className={styles.detailHead}>
        <button type="button" className={styles.detailBack} onClick={onBack}>
          ← Back to schools
        </button>
        <h2 className={styles.detailTitle}>{name}</h2>
        <span className={styles.detailMeta}>
          Join code <code style={{ letterSpacing: '2px' }}>{joinCode}</code>
        </span>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.tabs} style={{ marginBottom: '0.9rem' }}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            className={`${styles.tab} ${view === v.key ? styles.tabOn : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {v.count != null && <span> · {v.count}</span>}
          </button>
        ))}
      </div>

      {view === 'admins' && (
        !detail ? <p className={styles.loading}>Loading…</p>
        : admins.length === 0 ? <p className={styles.emptyMsg}>No admins yet.</p>
        : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Since</th></tr>
            </thead>
            <tbody>
              {admins.map(a => (
                <tr key={a.id}>
                  <td>{a.real_name || <span className={styles.emptyMsg}>—</span>}</td>
                  <td>{a.email || a.username}</td>
                  <td className={styles.timeCell}>{formatTimestamp(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {view === 'teachers' && (
        !detail ? <p className={styles.loading}>Loading…</p>
        : teachers.length === 0 ? <p className={styles.emptyMsg}>No teachers yet.</p>
        : (
          <table className={styles.subTable}>
            <thead>
              <tr><th>Teacher</th><th>Classes</th><th>Students</th><th>Since</th></tr>
            </thead>
            <tbody>
              {teachers.map(t => (
                <tr key={t.id}>
                  <td>{t.email || t.username}</td>
                  <td><Num value={t.classroom_count} /></td>
                  <td><Num value={t.student_count} /></td>
                  <td className={styles.timeCell}>{formatTimestamp(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {view === 'students' && (
        !students ? <p className={styles.loading}>Loading…</p>
        : students.length === 0 ? (
          <p className={styles.emptyMsg}>No students yet — they appear once teachers add them to classes.</p>
        ) : (
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Handle</th>
                <th>Real name</th>
                <th>Class · teacher</th>
                <th style={{ textAlign: 'right' }}>Week</th>
                <th style={{ textAlign: 'right' }}>Month</th>
                <th style={{ textAlign: 'right' }}>Year</th>
                <th style={{ textAlign: 'right' }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{renderAvatar(s.avatar)}</span>
                    {s.needs_handle ? <em className={styles.emptyMsg}>new adventurer</em> : s.username}
                  </td>
                  <td>{s.real_name || <span className={styles.emptyMsg}>—</span>}</td>
                  <td className={styles.emptyMsg} style={{ fontSize: 13 }}>
                    {s.classrooms || '—'}
                    {s.teachers ? <> · {s.teachers}</> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.week_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.month_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.year_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtLastSeen(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Section>
  );
}

// Inline "add an admin by email" panel for one school.
function AddAdminForm({ school, onCancel, onSubmit }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handle(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(email);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className={styles.controls} style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' }}>
      <span className={styles.emptyMsg} style={{ margin: 0 }}>
        Admin for <strong>{school.name}</strong>:
      </span>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Admin email — we'll email them a login link"
        disabled={busy}
        autoFocus
        required
        style={{ flex: '1 1 240px' }}
      />
      <button type="submit" className={styles.addBtnAligned} disabled={busy || !email.trim()}>
        {busy ? 'Adding…' : 'Add admin'}
      </button>
      <button type="button" className={styles.linkBtn} onClick={onCancel} disabled={busy}>
        cancel
      </button>
      {error && <p className={styles.error} style={{ flexBasis: '100%' }}>{error}</p>}
    </form>
  );
}

// Spelling-audio inspector — lists every word per grade with a play button that
// hits the real pre-generated /audio/spelling/<word>.mp3 (NOT the browser-speech
// fallback), so a keeper can confirm each clip sounds right and spot any that
// failed to generate.
function AdminSpelling() {
  const [grade, setGrade] = useState(SPELLING_GRADES[0]?.grade ?? 1);
  const [filter, setFilter] = useState('');
  const [playing, setPlaying] = useState(null); // word currently playing
  const [missing, setMissing] = useState({});   // { [word]: true } files that 404'd

  const words = [...(SPELLING_WORDS[grade] || [])].sort((a, b) => a.localeCompare(b));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? words.filter(w => w.includes(needle)) : words;
  const missingCount = words.filter(w => missing[w]).length;

  function play(word) {
    const audio = new Audio(audioFileFor(word));
    setPlaying(word);
    const done = () => setPlaying(p => (p === word ? null : p));
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', () => {
      setMissing(m => ({ ...m, [word]: true }));
      done();
    }, { once: true });
    audio.play().catch(() => {
      setMissing(m => ({ ...m, [word]: true }));
      done();
    });
  }

  return (
    <div className={styles.analyticsWrap}>
      <div className={styles.controls}>
        <label className={styles.controlLabel}>
          Grade
          <select
            className={styles.sizeSelect}
            value={grade}
            onChange={e => { setGrade(Number(e.target.value)); setFilter(''); }}
          >
            {SPELLING_GRADES.map(g => (
              <option key={g.grade} value={g.grade}>{g.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.controlLabel}>
          Find a word
          <input
            type="text"
            className={styles.addInput}
            placeholder="type to filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </label>
      </div>

      <Section title={`${shown.length} word${shown.length === 1 ? '' : 's'}${missingCount ? ` · ${missingCount} missing audio` : ''}`}>
        <p className={styles.emptyMsg} style={{ marginTop: 0, marginBottom: '0.75rem' }}>
          Tap a word to hear its <code>/audio/spelling/&lt;word&gt;.mp3</code>. A red
          ✗ means the file is missing or wouldn&rsquo;t play — run{' '}
          <code>scripts/generate-spelling-audio.cjs</code> to (re)generate it.
        </p>
        {shown.length === 0 ? (
          <p className={styles.emptyMsg}>No words match &ldquo;{filter}&rdquo;.</p>
        ) : (
          <div className={styles.wordGrid}>
            {shown.map(word => (
              <button
                key={word}
                type="button"
                className={`${styles.wordChip} ${playing === word ? styles.wordChipOn : ''} ${missing[word] ? styles.wordChipMissing : ''}`}
                onClick={() => play(word)}
                title={audioFileFor(word)}
              >
                <span className={styles.wordChipIcon} aria-hidden="true">
                  {missing[word] ? '✗' : playing === word ? '▶' : '🔊'}
                </span>
                {word}
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// Dragon manager — the keeper's full CRUD over the collectible dragons. Each
// dragon (the public/dragon_pngs/<id>.png art) can be renamed, reclassified by
// rarity, retired (soft-delete: kids keep ones they caught, but it stops being
// handed out), restored, or permanently deleted (hard-delete for copyright
// takedowns — also wipes kids' copies). New dragons are added by uploading a
// PNG. A filter narrows the grid so a keeper can sweep through one rarity (or
// the retired pile) without scrolling past everything.
function AdminDragons({ password }) {
  const [dragons, setDragons] = useState(null); // [{ dragon_id, name, rarity, retired }]
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');    // 'all' | 'retired' | rarity key
  const [rowStatus, setRowStatus] = useState({});  // { [dragonId]: 'saving' | 'saved' | 'error:msg' }
  const { confirm, dialog } = useDialog();

  function reload() {
    return adminFetch('/api/admin/dragons', password)
      .then(({ dragons }) => setDragons(dragons || []))
      .catch(err => setLoadError(err.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  function flashSaved(dragonId) {
    setRowStatus(s => ({ ...s, [dragonId]: 'saved' }));
    setTimeout(() => {
      setRowStatus(s => {
        if (s[dragonId] !== 'saved') return s;
        const { [dragonId]: _drop, ...rest } = s;
        return rest;
      });
    }, 1200);
  }

  // PUT a partial change and merge the server's row back into local state.
  async function patchDragon(dragonId, fields) {
    setRowStatus(s => ({ ...s, [dragonId]: 'saving' }));
    try {
      const row = await adminFetch(`/api/admin/dragons/${dragonId}`, password, {
        method: 'PUT',
        body: JSON.stringify(fields),
      });
      setDragons(ds => ds.map(d => (d.dragon_id === dragonId ? row : d)));
      flashSaved(dragonId);
    } catch (err) {
      setRowStatus(s => ({ ...s, [dragonId]: `error:${err.message}` }));
      reload(); // resync after a failed optimistic edit
    }
  }

  async function retireDragon(dragonId, retired) {
    if (retired) {
      // Retire = soft delete (DELETE endpoint). Restore = PUT { retired:false }.
      setRowStatus(s => ({ ...s, [dragonId]: 'saving' }));
      try {
        const row = await adminFetch(`/api/admin/dragons/${dragonId}`, password, { method: 'DELETE' });
        setDragons(ds => ds.map(d => (d.dragon_id === dragonId ? row : d)));
        flashSaved(dragonId);
      } catch (err) {
        setRowStatus(s => ({ ...s, [dragonId]: `error:${err.message}` }));
        reload();
      }
    } else {
      await patchDragon(dragonId, { retired: false });
    }
  }

  async function hardDelete(dragon) {
    const ok = await confirm({
      title: `Permanently delete “${dragon.name || `Dragon #${dragon.dragon_id}`}”?`,
      message:
        'This erases the art and removes it from every kid who collected it. ' +
        'Use this only for copyright takedowns — to simply stop handing a dragon out, retire it instead. This cannot be undone.',
      confirmLabel: 'Delete forever',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setRowStatus(s => ({ ...s, [dragon.dragon_id]: 'saving' }));
    try {
      await adminFetch(`/api/admin/dragons/${dragon.dragon_id}/permanent`, password, { method: 'DELETE' });
      setDragons(ds => ds.filter(d => d.dragon_id !== dragon.dragon_id));
    } catch (err) {
      setRowStatus(s => ({ ...s, [dragon.dragon_id]: `error:${err.message}` }));
    }
  }

  // Per-rarity tallies (active only) + a retired count, for the filter labels.
  const tallies = useMemo(() => {
    const t = Object.fromEntries(RARITIES.map(r => [r.key, 0]));
    let retired = 0;
    for (const d of dragons || []) {
      if (d.retired) { retired += 1; continue; }
      if (t[d.rarity] === undefined) t[d.rarity] = 0;
      t[d.rarity] += 1;
    }
    return { ...t, retired };
  }, [dragons]);

  const activeCount = (dragons || []).filter(d => !d.retired).length;

  const shown = useMemo(() => {
    const all = dragons || [];
    if (filter === 'all') return all.filter(d => !d.retired);
    if (filter === 'retired') return all.filter(d => d.retired);
    return all.filter(d => !d.retired && d.rarity === filter);
  }, [dragons, filter]);

  if (loadError) return <p className={styles.error}>{loadError}</p>;
  if (!dragons) return <p className={styles.loading}>Loading…</p>;

  return (
    <div className={styles.analyticsWrap}>
      {dialog}

      <AddDragonForm password={password} onAdded={reload} />

      <div className={styles.controls}>
        <label className={styles.controlLabel}>
          Show
          <select
            className={styles.sizeSelect}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">All dragons ({activeCount})</option>
            {RARITIES.map(r => (
              <option key={r.key} value={r.key}>{r.label} ({tallies[r.key]})</option>
            ))}
            <option value="retired">Retired ({tallies.retired})</option>
          </select>
        </label>
      </div>

      <Section title={`${shown.length} dragon${shown.length === 1 ? '' : 's'}`}>
        <p className={styles.emptyMsg} style={{ marginTop: 0, marginBottom: '0.75rem' }}>
          Rename a dragon, set its rarity, or <strong>retire</strong> it to stop it being
          handed out (kids keep ones they already caught). Changes save instantly.
          Permanent delete is for copyright takedowns only.
        </p>
        <div className={styles.dragonGrid}>
          {shown.map(d => {
            const id = d.dragon_id;
            const meta = rarityMeta(d.rarity);
            const status = rowStatus[id];
            return (
              <div
                key={id}
                className={`${styles.dragonCard} ${d.retired ? styles.dragonCardRetired : ''}`}
                style={{ '--rarity': meta.color, '--rarity-glow': meta.glow }}
              >
                <div className={styles.dragonThumbWrap}>
                  <img
                    src={dragonImage(id)}
                    alt={d.name || `Dragon ${id}`}
                    className={styles.dragonThumb}
                    loading="lazy"
                  />
                  <span className={styles.dragonId}>#{id}</span>
                  {d.retired && <span className={styles.dragonRetiredTag}>retired</span>}
                  {status === 'saving' && <span className={styles.dragonStatusSaving}>saving…</span>}
                  {status === 'saved' && <span className={styles.dragonStatusSaved}>✓</span>}
                </div>
                <DragonNameInput
                  value={d.name || ''}
                  onSave={name => { if (name && name !== d.name) patchDragon(id, { name }); }}
                />
                <select
                  className={styles.dragonRaritySelect}
                  value={d.rarity}
                  onChange={e => patchDragon(id, { rarity: e.target.value })}
                >
                  {RARITIES.map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
                <div className={styles.dragonActions}>
                  <button
                    type="button"
                    className={styles.dragonRetireBtn}
                    onClick={() => retireDragon(id, !d.retired)}
                  >
                    {d.retired ? 'Restore' : 'Retire'}
                  </button>
                  <button
                    type="button"
                    className={styles.dragonDeleteBtn}
                    onClick={() => hardDelete(d)}
                    title="Permanently delete (copyright takedown)"
                  >
                    Delete
                  </button>
                </div>
                {status?.startsWith('error:') && (
                  <span className={styles.errorInline}>{status.slice(6)}</span>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// A dragon's name field — edits locally, commits on blur or Enter (Escape
// reverts). Kept controlled-but-local so typing doesn't fire a PUT per keystroke.
function DragonNameInput({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      className={styles.dragonNameInput}
      value={draft}
      maxLength={40}
      placeholder="Name this dragon"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onSave(draft.trim())}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

// Upload form for adding a brand-new dragon: pick a PNG, name it, choose a
// rarity. The image is read as a base64 data URL and POSTed; the server claims
// the next id, writes the art, and inserts the catalog row.
function AddDragonForm({ password, onAdded }) {
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState(DEFAULT_RARITY);
  const [dataUrl, setDataUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  function pickFile(e) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'image/png') { setError('Please choose a PNG image.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Image must be under 10MB.'); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsDataURL(file);
  }

  function reset() {
    setName(''); setRarity(DEFAULT_RARITY); setDataUrl(''); setFileName(''); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Give your dragon a name.'); return; }
    if (!dataUrl) { setError('Choose a PNG image to upload.'); return; }
    setBusy(true);
    try {
      await adminFetch('/api/admin/dragons', password, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), rarity, image: dataUrl }),
      });
      reset();
      setOpen(false);
      await onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className={styles.controls}>
        <button type="button" className={styles.addBtnAligned} onClick={() => setOpen(true)}>
          + Add a dragon
        </button>
      </div>
    );
  }

  return (
    <Section title="Add a dragon">
      <form className={styles.addDragonForm} onSubmit={submit}>
        <div className={styles.addDragonPreview}>
          {dataUrl
            ? <img src={dataUrl} alt="New dragon preview" className={styles.dragonThumb} />
            : <span className={styles.addDragonPlaceholder}>PNG preview</span>}
        </div>
        <div className={styles.addDragonFields}>
          <label className={styles.controlLabel}>
            Art (PNG)
            <input type="file" accept="image/png" onChange={pickFile} />
          </label>
          {fileName && <span className={styles.addDragonFileName}>{fileName}</span>}
          <label className={styles.controlLabel}>
            Name
            <input
              className={styles.dragonNameInput}
              value={name}
              maxLength={40}
              placeholder="e.g. Sparkle Cloudtail"
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label className={styles.controlLabel}>
            Rarity
            <select className={styles.sizeSelect} value={rarity} onChange={e => setRarity(e.target.value)}>
              {RARITIES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          {error && <span className={styles.errorInline}>{error}</span>}
          <div className={styles.dragonActions}>
            <button type="submit" className={styles.addBtnAligned} disabled={busy}>
              {busy ? 'Uploading…' : 'Add dragon'}
            </button>
            <button
              type="button"
              className={styles.dragonRetireBtn}
              onClick={() => { reset(); setOpen(false); }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

const OP_SYMBOL = { add: '+', sub: '−', mul: '×', div: '÷' };

function formatMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  // Postgres returns 'YYYY-MM-DD HH:MM:SS[.ffffff][+00]'. Normalize for Date():
  // swap the space for 'T', and expand a bare hour-only offset like '+00' to
  // '+00:00' (Date() rejects '+00', which is what made these print raw before).
  let s = iso.trim().replace(' ', 'T');
  const hasTz = /[zZ]$|[+-]\d{2}(:?\d{2})?$/.test(s);
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  const d = new Date(hasTz ? s : s + 'Z');
  if (isNaN(d.getTime())) return iso;
  // Compact: e.g. "6/15/26, 1:50 AM" so it fits the column.
  return d.toLocaleString(undefined, {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
                {isImageAvatar(u.avatar) ? '🐉' : u.avatar} {u.username}
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

function AddAdultForm({ password, onCancel, onCreated, initialRole = 'parent' }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState(initialRole);
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

// Compact, non-wrapping level badge for the accounts table — the node number,
// its map icon, and the node name as one pill so the column reads at a glance
// instead of wrapping to three lines.
function LevelPill({ nodeId }) {
  const node = MAP_NODES.find(n => n.id === nodeId);
  return (
    <span className={styles.levelPill}>
      <span className={styles.levelNum}>#{nodeId}</span>
      {node && <span className={styles.levelIcon} aria-hidden="true">{node.icon}</span>}
      <span className={styles.levelName}>{node ? node.label : '—'}</span>
    </span>
  );
}

// Numeric cell value that dims zeros so real activity pops out of a long list
// of brand-new (all-zero) accounts.
function Num({ value, suffix }) {
  if (!value) return <span className={styles.zero}>0</span>;
  return <span>{value}{suffix}</span>;
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

function Section({ title, children, className = '', action }) {
  return (
    <section className={`${styles.section} ${className}`}>
      {action ? (
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className={styles.sectionTitle}>{title}</h2>
      )}
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
