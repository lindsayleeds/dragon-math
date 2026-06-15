import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useDialog } from '../components/ConfirmModal';
import { LoginLinkModal } from '../components/LoginLinkModal';
import { renderAvatar } from '../utils/avatar';
import { WORLDS } from '../data/mapData';
import styles from '../styles/ParentDashboard.module.css';

function worldForNode(nodeId) {
  return WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
}

export function TeacherClassroomPage() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [linkChild, setLinkChild] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const { confirm, alert, dialog } = useDialog();

  async function refresh() {
    setLoading(true);
    try {
      const { classroom, students } = await api.get(`/api/classroom/${classroomId}`);
      setClassroom(classroom);
      setStudents(students);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [classroomId]);

  async function handleAddStudent() {
    setBusy(true);
    try {
      const { student } = await api.post(`/api/classroom/${classroomId}/students`, {});
      await refresh();
      setLinkChild(student); // pop the QR straight away
    } catch (err) {
      alert({ title: 'Could not add student', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(studentId, name) {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: `Take ${name} off this class roster? Their dragon account isn’t deleted — they just leave the class.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/classroom/${classroomId}/students/${studentId}`);
      refresh();
    } catch (err) {
      alert({ title: 'Could not remove', message: err.message });
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(classroom.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  async function handleRotateCode() {
    const ok = await confirm({
      title: 'New join code?',
      message: 'The old code will stop working. Students already in the class stay enrolled.',
      confirmLabel: 'Generate new code',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    try {
      const { join_code } = await api.post(`/api/classroom/${classroomId}/rotate-code`, {});
      setClassroom(prev => ({ ...prev, join_code }));
    } catch (err) {
      alert({ title: 'Could not rotate code', message: err.message });
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{classroom?.name || 'Classroom'}</h1>
          <p className={styles.sub}>
            <button className={styles.linkBtn} onClick={() => navigate('/teacher')}>← All classrooms</button>
          </p>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {classroom && (
        <section className={styles.section}>
          <h2>Join code</h2>
          <p className={styles.muted}>
            Students who already have a dragon account can join by entering this code from their
            Classroom page.
          </p>
          <div className={styles.qrActions}>
            <span className={styles.statValue} style={{ letterSpacing: '4px' }}>{classroom.join_code}</span>
            <button className={styles.linkBtn} onClick={handleCopyCode}>{copied ? 'Copied!' : 'Copy code'}</button>
            <button className={styles.linkBtn} onClick={handleRotateCode}>New code</button>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Students</h2>
          <button className={styles.primaryBtn} onClick={handleAddStudent} disabled={busy}>
            {busy ? 'Adding…' : '+ Add student (QR)'}
          </button>
        </div>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : students.length === 0 ? (
          <div className={styles.emptyCard}>
            <p>No students yet.</p>
            <p className={styles.muted}>
              Share the join code above, or tap “Add student” to create a QR sign-in card for a
              kid who doesn’t have an account.
            </p>
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {students.map(s => {
              const world = worldForNode(s.current_node_id);
              return (
                <article key={s.id} className={styles.kidCard}>
                  <div className={styles.kidHeader}>
                    <span className={styles.kidAvatar}>{renderAvatar(s.avatar)}</span>
                    <div>
                      <div className={styles.kidName}>{s.needs_handle ? 'New adventurer' : s.username}</div>
                      {s.needs_handle ? (
                        <span className={styles.waitingBadge}>Waiting to set up</span>
                      ) : (
                        <div className={styles.kidWorld}>
                          {world ? `${world.name} · Level ${s.current_node_id}` : `Level ${s.current_node_id}`}
                        </div>
                      )}
                    </div>
                  </div>

                  <dl className={styles.kidStats}>
                    <div><dt>Dragons</dt><dd>{s.dragons_collected}</dd></div>
                  </dl>

                  <div className={styles.kidActions}>
                    {s.login_token && (
                      <button className={styles.primaryBtn} onClick={() => setLinkChild(s)}>
                        {s.needs_handle ? 'Show QR' : 'Login link'}
                      </button>
                    )}
                    <button
                      className={styles.linkBtn}
                      onClick={() => handleRemove(s.id, s.needs_handle ? 'this adventurer' : s.username)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {linkChild && <LoginLinkModal child={linkChild} onClose={() => setLinkChild(null)} />}
      {dialog}
    </div>
  );
}
