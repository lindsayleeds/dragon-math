import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/ParentDashboard.module.css';

const WINDOWS = [
  { key: 'week', label: 'This week', col: 'week_minutes' },
  { key: 'month', label: 'This month', col: 'month_minutes' },
  { key: 'year', label: 'This year', col: 'year_minutes' },
];

// Minutes → friendly "5h 12m" / "47m" / "0m".
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

export function ClassroomStatsPage() {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [windowKey, setWindowKey] = useState('week');
  // Column to sort by; null means follow the active window.
  const [sortCol, setSortCol] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { classroom, students } = await api.get(`/api/classroom/${classroomId}/stats`);
        if (!alive) return;
        setClassroom(classroom);
        setStudents(students);
        setError(null);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [classroomId]);

  const active = WINDOWS.find(w => w.key === windowKey);
  const sortBy = sortCol || active.col;

  const sorted = useMemo(() => {
    const rows = [...students];
    rows.sort((a, b) => {
      if (sortBy === 'username') {
        return (a.username || '').localeCompare(b.username || '');
      }
      return (b[sortBy] || 0) - (a[sortBy] || 0) || (a.username || '').localeCompare(b.username || '');
    });
    return rows;
  }, [students, sortBy]);

  const totals = useMemo(() => {
    const col = active.col;
    const sum = students.reduce((acc, s) => acc + (s[col] || 0), 0);
    const played = students.filter(s => (s[col] || 0) > 0).length;
    const avg = students.length ? Math.round(sum / students.length) : 0;
    return { sum, played, avg, size: students.length };
  }, [students, active]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{classroom?.name || 'Class'} · Stats</h1>
          <p className={styles.sub}>
            <button className={styles.linkBtn} onClick={() => navigate(`/teacher/classroom/${classroomId}`)}>
              ← Back to classroom
            </button>
          </p>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.section}>
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

        <div className={styles.cardGrid} style={{ marginTop: 12 }}>
          <div className={styles.statBox}>
            <div className={styles.statLabel}>total minutes</div>
            <div className={styles.statValue}>{fmtMinutes(totals.sum)}</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statLabel}>average per student</div>
            <div className={styles.statValue}>{fmtMinutes(totals.avg)}</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statLabel}>students who played</div>
            <div className={styles.statValue}>{totals.played}/{totals.size}</div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>By student</h2>
        <p className={styles.muted}>
          One minute = one minute actively playing a math battle. Tap a column to sort.
        </p>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : students.length === 0 ? (
          <p className={styles.muted}>No students in this class yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortCol('username')}>student</th>
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
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{renderAvatar(s.avatar)}</span>
                    {s.needs_handle ? 'New adventurer' : s.username}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.week_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.month_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMinutes(s.year_minutes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtLastSeen(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
