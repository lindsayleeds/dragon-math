import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAP_NODES, WORLDS, NODE_TYPE } from '../data/mapData';
import { BATTLE_SHAPES_LIST } from '../data/battleShapes';
import { SPELLING_WORDS, SPELLING_GRADES, audioFileFor } from '../data/spellingWords';
import { RARITIES, DEFAULT_RARITY, rarityMeta, dragonImage } from '../data/dragonRarity';
import { useDialog } from '../components/ConfirmModal';
import { LoginLinkModal } from '../components/LoginLinkModal';
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
        <h1 className={styles.title}>Admin</h1>
        <Link to="/map" className={styles.headerBack}>← Map</Link>
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
        </div>
      </header>
      {tab === 'config'    && <AdminEditor    password={password} />}
      {tab === 'accounts'  && <AdminAccounts  password={password} />}
      {tab === 'analytics' && <AdminAnalytics password={password} />}
      {tab === 'dragons'   && <AdminDragons   password={password} />}
      {tab === 'spelling'  && <AdminSpelling />}
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

// Kids who haven't picked a handle yet have their (UUID) login token seeded as
// a placeholder username — show something friendly instead of the raw GUID.
function childLabel(child) {
  return child.needs_handle ? 'New adventurer' : child.username;
}

function AdminAccounts({ password }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showAddAdult, setShowAddAdult] = useState(false);
  const [trialBusyId, setTrialBusyId] = useState(null);
  const [tokenBusyId, setTokenBusyId] = useState(null);
  const [linkChild, setLinkChild] = useState(null);
  const [view, setView] = useState('adults');
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
  const parentCount  = parents.filter(p => (p.adult_role || 'parent') === 'parent').length;
  const teacherCount = parents.filter(p => p.adult_role === 'teacher').length;

  const needle = childFilter.trim().toLowerCase();
  const shownChildren = needle
    ? children.filter(c => childLabel(c).toLowerCase().includes(needle))
    : children;

  return (
    <div className={styles.analyticsWrap}>
      <div className={styles.acctTabs} role="tablist" aria-label="Account view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'adults'}
          className={`${styles.acctTab} ${view === 'adults' ? styles.acctTabOn : ''}`}
          onClick={() => setView('adults')}
        >
          <span className={styles.acctTabIcon} aria-hidden>👪</span>
          Adults
          <span className={styles.acctTabCount}>{parents.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'children'}
          className={`${styles.acctTab} ${view === 'children' ? styles.acctTabOn : ''}`}
          onClick={() => setView('children')}
        >
          <span className={styles.acctTabIcon} aria-hidden>🧒</span>
          Children
          <span className={styles.acctTabCount}>{children.length}</span>
        </button>
      </div>

      {view === 'adults' ? (
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
      ) : (
      <Section title={`Children (${needle ? `${shownChildren.length} of ${children.length}` : children.length})`}>
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
          <div className={styles.subTableScroll}>
          <table className={styles.subTable}>
            <thead>
              <tr>
                <th>Child</th>
                <th>Level</th>
                <th className={styles.numCell}>Attempts</th>
                <th>Trial</th>
                <th>Login link</th>
                <th>Linked adults</th>
                <th>Last active</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {shownChildren.map(c => (
                <tr key={c.id}>
                  <td>
                    <span className={styles.childCell}>
                      <span className={styles.childAvatar} aria-hidden="true">{renderAvatar(c.avatar)}</span>
                      <span className={styles.childName} title={childLabel(c)}>{childLabel(c)}</span>
                    </span>
                  </td>
                  <td><LevelPill nodeId={c.current_node_id} /></td>
                  <td className={styles.numCell}><Num value={c.attempt_count} /></td>
                  <td>
                    {c.dragon_trial_completed ? (
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
                    ) : <span className={styles.zero}>—</span>}
                  </td>
                  <td>
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
                  </td>
                  <td className={styles.emailCell} title={c.parent_emails || ''}>
                    {c.parent_emails || <span className={styles.zero}>—</span>}
                  </td>
                  <td className={styles.timeCell}>{formatTimestamp(c.last_attempt_at)}</td>
                  <td className={styles.timeCell}>{formatTimestamp(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>
      )}
      {linkChild && (
        <LoginLinkModal child={linkChild} onClose={() => setLinkChild(null)} />
      )}
      {dialog}
    </div>
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
