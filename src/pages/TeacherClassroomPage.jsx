import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useDialog } from '../hooks/useDialog';
import { LoginLinkModal } from '../components/LoginLinkModal';
import { CreateStudentModal } from '../components/CreateStudentModal';
import { RealNameModal } from '../components/RealNameModal';
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
  const [editNameChild, setEditNameChild] = useState(null);
  const [creating, setCreating] = useState(false);
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

  // Teacher-named student: returns an error message on failure (so the modal can
  // show it inline), or null on success — at which point we close the create
  // modal and pop the QR for the teacher to show the student.
  async function handleCreateStudent(username, realName) {
    try {
      const { student } = await api.post(`/api/classroom/${classroomId}/students`, {
        username,
        real_name: realName || '',
      });
      await refresh();
      setCreating(false);
      setLinkChild(student);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  async function handleSaveRealName(value) {
    try {
      await api.patch(`/api/classroom/${classroomId}/students/${editNameChild.id}`, { real_name: value });
      setStudents(prev => prev.map(s => (s.id === editNameChild.id ? { ...s, real_name: value || null } : s)));
      setEditNameChild(null);
      return null;
    } catch (err) {
      return err.message;
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

  // Open the login-link modal for a student. Kids who joined with their own
  // account have no token yet — mint one on demand so the teacher always has a
  // link to hand out (or recover) for anyone on the roster.
  async function handleShowLink(student) {
    if (student.login_token) {
      setLinkChild(student);
      return;
    }
    try {
      const { login_token } = await api.post(
        `/api/classroom/${classroomId}/students/${student.id}/login-link`, {},
      );
      const withToken = { ...student, login_token };
      setStudents(prev => prev.map(s => (s.id === student.id ? withToken : s)));
      setLinkChild(withToken);
    } catch (err) {
      alert({ title: 'Could not get login link', message: err.message });
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
            {' '}
            <button className={styles.linkBtn} onClick={() => navigate(`/teacher/classroom/${classroomId}/stats`)}>
              Class stats →
            </button>
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
          <div className={styles.qrActions}>
            <button className={styles.primaryBtn} onClick={() => setCreating(true)}>
              + Create student
            </button>
            <button className={styles.linkBtn} onClick={handleAddStudent} disabled={busy}>
              {busy ? 'Adding…' : 'Add blank (kid names it)'}
            </button>
          </div>
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
                      {s.real_name && <div className={styles.kidWorld}>{s.real_name}</div>}
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
                    <button className={styles.primaryBtn} onClick={() => handleShowLink(s)}>
                      {s.needs_handle ? 'Show QR' : 'Login link'}
                    </button>
                    <button className={styles.linkBtn} onClick={() => setEditNameChild(s)}>
                      {s.real_name ? 'Edit name' : 'Add name'}
                    </button>
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

      {creating && (
        <CreateStudentModal onCreate={handleCreateStudent} onClose={() => setCreating(false)} />
      )}
      {linkChild && <LoginLinkModal child={linkChild} onClose={() => setLinkChild(null)} />}
      {editNameChild && (
        <RealNameModal
          handle={editNameChild.needs_handle ? null : editNameChild.username}
          current={editNameChild.real_name}
          onSave={handleSaveRealName}
          onClose={() => setEditNameChild(null)}
        />
      )}
      {dialog}
    </div>
  );
}
