import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { useDialog } from '../components/ConfirmModal';
import styles from '../styles/ParentDashboard.module.css';

export function TeacherDashboardPage() {
  const navigate = useNavigate();
  const { user, enterTestMode } = useAuthContext();
  const { logout } = useAuth();
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const { dialog } = useDialog();

  async function refresh() {
    setLoading(true);
    try {
      const { classrooms } = await api.get('/api/classroom/mine');
      setClassrooms(classrooms);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Teacher’s field notes</h1>
          <p className={styles.sub}>Signed in as {user?.email}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.linkBtn} onClick={() => { enterTestMode(); navigate('/home'); }}>
            🎮 Test the games
          </button>
          <button className={styles.linkBtn} onClick={async () => { await logout(); navigate('/auth'); }}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Your classrooms</h2>
          <button className={styles.primaryBtn} onClick={() => setShowCreate(true)}>+ New classroom</button>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : classrooms.length === 0 ? (
          <div className={styles.emptyCard}>
            <p>No classrooms yet.</p>
            <p className={styles.muted}>
              Tap “New classroom” to start a class. You’ll get a join code students can enter,
              and you can also create QR sign-in cards for kids with no account yet.
            </p>
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {classrooms.map(c => (
              <article key={c.id} className={styles.kidCard}>
                <div className={styles.kidHeader}>
                  <span className={styles.kidAvatar}>🏫</span>
                  <div>
                    <div className={styles.kidName}>{c.name}</div>
                    <div className={styles.kidWorld}>
                      {c.student_count} {c.student_count === 1 ? 'student' : 'students'} · code {c.join_code}
                    </div>
                  </div>
                </div>
                <div className={styles.kidActions}>
                  <Link className={styles.primaryBtn} to={`/teacher/classroom/${c.id}`}>Open class</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <CreateClassroomModal
          onClose={() => setShowCreate(false)}
          onCreated={(classroom) => { setShowCreate(false); navigate(`/teacher/classroom/${classroom.id}`); }}
        />
      )}
      {dialog}
    </div>
  );
}

function CreateClassroomModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { classroom } = await api.post('/api/classroom', { name: name.trim() });
      onCreated(classroom);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>New classroom</h3>
        <p className={styles.muted}>Give your class a name — e.g. “Room 12” or “Ms. Lee’s 3rd Grade”.</p>
        <form onSubmit={handleCreate} className={styles.form}>
          <label className={styles.label}>
            Class name
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className={styles.input}
              maxLength={60}
              autoFocus
              required
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primaryBtn} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create classroom'}
          </button>
        </form>
      </div>
    </div>
  );
}
