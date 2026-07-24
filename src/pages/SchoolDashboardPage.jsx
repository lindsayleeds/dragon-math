import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { useDialog } from '../components/ConfirmModal';
import { RealNameModal } from '../components/RealNameModal';
import { BulkImportModal } from '../components/BulkImportModal';
import { WelcomeEmailModal } from '../components/WelcomeEmailModal';
import { renderAvatar } from '../utils/avatar';
import { homePathFor } from '../utils/homePath';
import { toCsv, downloadCsv } from '../utils/csv';
import styles from '../styles/ParentDashboard.module.css';

const WINDOWS = [
  { key: 'week', label: 'This week', col: 'week_minutes' },
  { key: 'month', label: 'This month', col: 'month_minutes' },
  { key: 'year', label: 'This year', col: 'year_minutes' },
];

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

export function SchoolDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { logout } = useAuth();
  const { confirm, alert, dialog } = useDialog();

  const [schools, setSchools] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { school, admins, teachers }
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('students');
  const [windowKey, setWindowKey] = useState('week');
  const [sortCol, setSortCol] = useState('username');
  const [editing, setEditing] = useState(null); // student whose real name we're editing
  const [editingAdmin, setEditingAdmin] = useState(null); // admin whose real name we're editing
  const [showImport, setShowImport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [adminError, setAdminError] = useState(null);
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherName, setNewTeacherName] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [teacherError, setTeacherError] = useState(null);
  const [lastTeacherInvite, setLastTeacherInvite] = useState(null); // { email, link, created }
  const [welcomeReceipt, setWelcomeReceipt] = useState(null); // { receipts: [...], bcc }

  async function loadSchools() {
    setLoading(true);
    try {
      const { schools } = await api.get('/api/school/mine');
      setSchools(schools);
      setSelectedId(prev => prev ?? (schools[0]?.id ?? null));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSchool(id) {
    if (!id) return;
    setStudentsLoading(true);
    try {
      const [detailRes, studentsRes] = await Promise.all([
        api.get(`/api/school/${id}`),
        api.get(`/api/school/${id}/students`),
      ]);
      setDetail(detailRes);
      setStudents(studentsRes.students);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setStudentsLoading(false);
    }
  }

  useEffect(() => { loadSchools(); }, []);
  useEffect(() => { if (selectedId) loadSchool(selectedId); }, [selectedId]);

  const active = WINDOWS.find(w => w.key === windowKey);
  const sortBy = sortCol || active.col;

  const sorted = useMemo(() => {
    const rows = [...students];
    rows.sort((a, b) => {
      if (sortBy === 'username') return (a.username || '').localeCompare(b.username || '');
      if (sortBy === 'real_name') return (a.real_name || '~').localeCompare(b.real_name || '~');
      return (b[sortBy] || 0) - (a[sortBy] || 0) || (a.username || '').localeCompare(b.username || '');
    });
    return rows;
  }, [students, sortBy]);

  async function handleSaveRealName(value) {
    try {
      await api.patch(`/api/school/${selectedId}/students/${editing.id}`, { real_name: value });
      setStudents(prev => prev.map(s => (s.id === editing.id ? { ...s, real_name: value || null } : s)));
      setEditing(null);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // Export the current student roster (already sorted the way the table shows it)
  // to a CSV a grown-up can open in a spreadsheet. Handles/real names plus the
  // three playtime windows and last-seen — everything on screen.
  function handleExportCsv() {
    const name = (school?.name || 'school').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const csv = toCsv(sorted, [
      { label: 'handle', value: s => (s.needs_handle ? '' : s.username) },
      { key: 'real_name', label: 'real_name' },
      { label: 'classes', value: s => s.classrooms || '' },
      { label: 'teachers', value: s => s.teachers || '' },
      { key: 'week_minutes', label: 'week_minutes' },
      { key: 'month_minutes', label: 'month_minutes' },
      { key: 'year_minutes', label: 'year_minutes' },
      { key: 'dragons_collected', label: 'dragons_collected' },
      { label: 'last_seen', value: s => (s.last_seen ? s.last_seen.slice(0, 10) : '') },
    ]);
    downloadCsv(`dragon-math-${name}-students-${today}.csv`, csv);
  }

  // Bulk import — hand the parsed rows to the server and refresh on success. The
  // modal owns the result UI (per-row outcomes + login-link download); we just
  // reload the roster so the new kids show up.
  async function handleImportStudents(rows) {
    const res = await api.post(`/api/school/${selectedId}/students/import`, { rows });
    if (res.summary.created > 0) loadSchool(selectedId);
    return res;
  }

  async function handleSaveAdminName(value) {
    try {
      await api.patch(`/api/school/${selectedId}/admins/${editingAdmin.id}`, { real_name: value });
      setDetail(prev => prev && ({
        ...prev,
        admins: prev.admins.map(a => (a.id === editingAdmin.id ? { ...a, real_name: value || null } : a)),
      }));
      setEditingAdmin(null);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(detail.school.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch { /* ignore */ }
  }

  async function handleAddTeacher(e) {
    e.preventDefault();
    const email = newTeacherEmail.trim();
    if (!email) return;
    setAddingTeacher(true);
    setTeacherError(null);
    try {
      const res = await api.post(`/api/school/${selectedId}/teachers`, {
        email,
        real_name: newTeacherName.trim(),
      });
      setNewTeacherEmail('');
      setNewTeacherName('');
      const link = res.login_link ? `${window.location.origin}${res.login_link}` : null;
      setLastTeacherInvite({ email: res.teacher.email || email, link, created: res.created });
      await loadSchool(selectedId);
    } catch (err) {
      setTeacherError(err.message);
    } finally {
      setAddingTeacher(false);
    }
  }

  async function handleRotateCode() {
    const ok = await confirm({
      title: 'New school code?',
      message: 'The old code stops working. Teachers already attached to the school stay attached.',
      confirmLabel: 'Generate new code',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    try {
      const { join_code } = await api.post(`/api/school/${selectedId}/rotate-code`, {});
      setDetail(prev => ({ ...prev, school: { ...prev.school, join_code } }));
    } catch (err) {
      alert({ title: 'Could not rotate code', message: err.message });
    }
  }

  async function handleDetachTeacher(teacher) {
    const label = teacher.email || teacher.username;
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: `Detach this teacher from the school? Their classrooms and students are untouched — they just stop rolling up here.`,
      confirmLabel: 'Detach',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/school/${selectedId}/teachers/${teacher.id}`);
      loadSchool(selectedId);
    } catch (err) {
      alert({ title: 'Could not detach teacher', message: err.message });
    }
  }

  async function handleAddAdmin(e) {
    e.preventDefault();
    const email = newAdminEmail.trim();
    if (!email) return;
    setAddingAdmin(true);
    setAdminError(null);
    try {
      const res = await api.post(`/api/school/${selectedId}/admins`, { email });
      setNewAdminEmail('');
      setWelcomeReceipt({
        bcc: res.bcc,
        receipts: [{
          email: res.admin.email || email,
          created: res.created,
          login_link: res.login_link,
          email_sent: res.email_sent,
          email_error: res.email_error,
        }],
      });
      await loadSchool(selectedId);
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setAddingAdmin(false);
    }
  }

  async function handleRemoveAdmin(admin) {
    const label = admin.email || admin.username;
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: `Revoke this person's admin access to the school? They keep their own account — they just can't manage the school anymore.`,
      confirmLabel: 'Remove admin',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/school/${selectedId}/admins/${admin.id}`);
      loadSchool(selectedId);
    } catch (err) {
      alert({ title: 'Could not remove admin', message: err.message });
    }
  }

  if (loading) {
    return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;
  }

  if (schools.length === 0) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>School</h1>
            <p className={styles.sub}>Signed in as {user?.email}</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.linkBtn} onClick={() => navigate(homePathFor(user))}>← Dashboard</button>
          </div>
        </header>
        <section className={styles.section}>
          <div className={styles.emptyCard}>
            <p>You don’t administer any schools yet.</p>
            <p className={styles.muted}>
              Schools are set up by the Dragon Math team. Once you’re named an admin, every
              student across your school’s teachers appears here.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const school = detail?.school;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{school?.name || 'School'}</h1>
          <p className={styles.sub}>
            Signed in as {user?.email}
            {schools.length > 1 && (
              <>
                {' · '}
                <select
                  className={styles.input}
                  style={{ display: 'inline-block', width: 'auto', padding: '2px 8px' }}
                  value={selectedId || ''}
                  onChange={e => { setSelectedId(Number(e.target.value)); setDetail(null); setStudents([]); }}
                >
                  {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.linkBtn} onClick={() => navigate(homePathFor(user))}>← Dashboard</button>
          <button className={styles.linkBtn} onClick={async () => { await logout(); navigate('/auth'); }}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <nav className={styles.viewTabs}>
        <button
          className={`${styles.viewTab} ${view === 'admins' ? styles.viewTabActive : ''}`}
          aria-pressed={view === 'admins'}
          onClick={() => setView('admins')}
        >
          🛡️ Admins
          {detail && <span className={styles.viewTabCount}>{detail.admins.length}</span>}
        </button>
        <button
          className={`${styles.viewTab} ${view === 'teachers' ? styles.viewTabActive : ''}`}
          aria-pressed={view === 'teachers'}
          onClick={() => setView('teachers')}
        >
          🍎 Teachers
          {detail && <span className={styles.viewTabCount}>{detail.teachers.length}</span>}
        </button>
        <button
          className={`${styles.viewTab} ${view === 'students' ? styles.viewTabActive : ''}`}
          aria-pressed={view === 'students'}
          onClick={() => setView('students')}
        >
          🎒 Students
          {!studentsLoading && <span className={styles.viewTabCount}>{students.length}</span>}
        </button>
      </nav>

      {view === 'admins' && (
      <section className={styles.section}>
        <h2>School admins</h2>
        <p className={styles.muted}>
          Admins can see every student, manage teachers, and add or remove other admins. Add one by
          email — no signup needed. We’ll email them a welcome message with a personal login link
          (or, if they already have an account, a note to sign in as usual).
        </p>
        <form
          onSubmit={handleAddAdmin}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, margin: '16px 0 12px' }}
        >
          <label className={styles.label} style={{ flex: '0 1 320px', margin: 0 }}>
            Grown-up’s email
            <input
              className={styles.input}
              type="email"
              value={newAdminEmail}
              onChange={e => { setNewAdminEmail(e.target.value); setAdminError(null); }}
              placeholder="admin@school.org"
              autoComplete="off"
              disabled={addingAdmin}
            />
          </label>
          <button className={styles.primaryBtn} type="submit" disabled={addingAdmin || !newAdminEmail.trim()}>
            {addingAdmin ? 'Adding…' : '+ Add admin'}
          </button>
        </form>
        {adminError && <p className={styles.error}>{adminError}</p>}

        {!detail ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          <div className={styles.cardGrid}>
            {detail.admins.map(a => {
              const isYou = user?.email && a.email && a.email.toLowerCase() === user.email.toLowerCase();
              return (
                <article key={a.id} className={styles.kidCard}>
                  <div className={styles.kidHeader}>
                    <span className={styles.kidAvatar}>🛡️</span>
                    <div className={styles.kidIdentity}>
                      <div className={styles.kidName}>
                        {a.real_name || a.email || a.username}
                        {isYou && <span className={styles.muted}> (you)</span>}
                      </div>
                      {a.real_name && a.email && (
                        <div className={styles.kidContact}>{a.email}</div>
                      )}
                    </div>
                  </div>
                  <div className={styles.kidActions}>
                    <button className={styles.linkBtn} onClick={() => setEditingAdmin(a)}>
                      {a.real_name ? 'Edit name' : 'Add name'}
                    </button>
                    {detail.admins.length > 1 && (
                      <button className={styles.linkBtn} onClick={() => handleRemoveAdmin(a)}>
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {view === 'teachers' && (
      <section className={styles.section}>
        <h2>Add a teacher</h2>
        <p className={styles.muted}>
          Add a teacher by email — no signup needed. We’ll create their account and give you a
          personal login link to share. They can also just “Sign in with Google” using this same
          email whenever they like; both open the same account.
        </p>
        <form
          onSubmit={handleAddTeacher}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, margin: '16px 0 12px' }}
        >
          <label className={styles.label} style={{ flex: '0 1 280px', margin: 0 }}>
            Teacher’s email
            <input
              className={styles.input}
              type="email"
              value={newTeacherEmail}
              onChange={e => { setNewTeacherEmail(e.target.value); setTeacherError(null); }}
              placeholder="teacher@school.org"
              autoComplete="off"
              disabled={addingTeacher}
            />
          </label>
          <label className={styles.label} style={{ flex: '0 1 220px', margin: 0 }}>
            Name <span className={styles.muted}>(optional)</span>
            <input
              className={styles.input}
              type="text"
              value={newTeacherName}
              onChange={e => setNewTeacherName(e.target.value)}
              placeholder="Ms. Rivera"
              autoComplete="off"
              disabled={addingTeacher}
            />
          </label>
          <button className={styles.primaryBtn} type="submit" disabled={addingTeacher || !newTeacherEmail.trim()}>
            {addingTeacher ? 'Adding…' : '+ Add teacher'}
          </button>
        </form>
        {teacherError && <p className={styles.error}>{teacherError}</p>}

        {lastTeacherInvite && (
          <div className={styles.emptyCard} style={{ marginTop: 8 }}>
            <p style={{ margin: '0 0 4px' }}>
              {lastTeacherInvite.created ? '✅ Added ' : '✅ Attached '}
              <strong>{lastTeacherInvite.email}</strong>.
            </p>
            {lastTeacherInvite.link ? (
              <>
                <p className={styles.muted} style={{ margin: '0 0 8px' }}>
                  Share this personal login link (or they can sign in with Google using the same email):
                </p>
                <div className={styles.qrActions}>
                  <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{lastTeacherInvite.link}</code>
                  <button
                    className={styles.linkBtn}
                    onClick={() => copyText(lastTeacherInvite.link, 'invite')}
                  >
                    {copiedKey === 'invite' ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.muted} style={{ margin: 0 }}>
                They already have an account — they sign in with their own password or Google.
              </p>
            )}
          </div>
        )}
      </section>
      )}

      {view === 'teachers' && school && (
        <section className={styles.section}>
          <h2>Teacher join code</h2>
          <p className={styles.muted}>
            Prefer teachers to add themselves? They enter this code from their dashboard to attach
            their classrooms to the school.
          </p>
          <div className={styles.qrActions}>
            <span className={styles.statValue} style={{ letterSpacing: '4px' }}>{school.join_code}</span>
            <button className={styles.linkBtn} onClick={handleCopyCode}>{copied ? 'Copied!' : 'Copy code'}</button>
            <button className={styles.linkBtn} onClick={handleRotateCode}>New code</button>
          </div>
        </section>
      )}

      {view === 'teachers' && (
      <section className={styles.section}>
        <h2>Teachers</h2>
        {!detail ? (
          <p className={styles.muted}>Loading…</p>
        ) : detail.teachers.length === 0 ? (
          <p className={styles.muted}>No teachers yet — add one above, or share the join code.</p>
        ) : (
          <div className={styles.cardGrid}>
            {detail.teachers.map(t => {
              const urlLogin = t.login_token && !t.has_password;
              return (
              <article key={t.id} className={styles.kidCard}>
                <div className={styles.kidHeader}>
                  <span className={styles.kidAvatar}>🍎</span>
                  <div className={styles.kidIdentity}>
                    <div className={styles.kidName}>{t.email || t.username}</div>
                    <div className={styles.kidWorld}>
                      {t.classroom_count} {t.classroom_count === 1 ? 'class' : 'classes'} ·{' '}
                      {t.student_count} {t.student_count === 1 ? 'student' : 'students'}
                      {urlLogin && <> · link login</>}
                    </div>
                  </div>
                </div>
                <div className={styles.kidActions}>
                  {urlLogin && (
                    <button
                      className={styles.linkBtn}
                      onClick={() => copyText(`${window.location.origin}/k/${t.login_token}`, `t-${t.id}`)}
                    >
                      {copiedKey === `t-${t.id}` ? 'Copied!' : 'Copy link'}
                    </button>
                  )}
                  <button className={styles.linkBtn} onClick={() => handleDetachTeacher(t)}>Detach</button>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {view === 'students' && (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Students</h2>
          <div className={styles.headerActions}>
            <button className={styles.linkBtn} onClick={() => setShowImport(true)}>⬆ Import CSV</button>
            <button
              className={styles.linkBtn}
              onClick={handleExportCsv}
              disabled={studentsLoading || students.length === 0}
            >
              ⬇ Export CSV
            </button>
          </div>
        </div>
        <div className={styles.tabRow}>
          {WINDOWS.map(w => (
            <button
              key={w.key}
              className={w.key === windowKey ? styles.tabBtnActive : styles.tabBtn}
              onClick={() => { setWindowKey(w.key); setSortCol(null); }}
            >
              {w.label}
            </button>
          ))}
        </div>
        <p className={styles.muted}>
          Every student across the school’s teachers. Handles are what kids see; real names are
          private to grown-ups. Tap a column to sort.
        </p>

        {studentsLoading ? (
          <p className={styles.muted}>Loading…</p>
        ) : students.length === 0 ? (
          <p className={styles.muted}>No students yet — they appear once teachers add them to classes.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortCol('username')}>handle</th>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortCol('real_name')}>real name</th>
                <th>class · teacher</th>
                {WINDOWS.map(w => (
                  <th
                    key={w.key}
                    style={{ cursor: 'pointer', textAlign: 'right', fontWeight: sortBy === w.col ? 700 : 400 }}
                    onClick={() => setSortCol(w.col)}
                  >
                    {w.key}
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{renderAvatar(s.avatar)}</span>
                    {s.needs_handle ? <em className={styles.muted}>new adventurer</em> : s.username}
                  </td>
                  <td>
                    {s.real_name || <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.muted} style={{ fontSize: 13 }}>
                    {s.classrooms || '—'}
                    {s.teachers ? <> · {s.teachers}</> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.week_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.month_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.year_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtLastSeen(s.last_seen)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className={styles.linkBtn} onClick={() => setEditing(s)}>
                      {s.real_name ? 'Edit name' : 'Add name'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}

      {editing && (
        <RealNameModal
          handle={editing.needs_handle ? null : editing.username}
          current={editing.real_name}
          onSave={handleSaveRealName}
          onClose={() => setEditing(null)}
        />
      )}
      {editingAdmin && (
        <RealNameModal
          handle={editingAdmin.email || editingAdmin.username}
          current={editingAdmin.real_name}
          onSave={handleSaveAdminName}
          onClose={() => setEditingAdmin(null)}
        />
      )}
      {showImport && (
        <BulkImportModal
          onImport={handleImportStudents}
          onClose={() => setShowImport(false)}
        />
      )}
      {welcomeReceipt && (
        <WelcomeEmailModal
          receipts={welcomeReceipt.receipts}
          bcc={welcomeReceipt.bcc}
          onClose={() => setWelcomeReceipt(null)}
        />
      )}
      {dialog}
    </div>
  );
}
