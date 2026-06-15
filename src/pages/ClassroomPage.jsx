import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/ClassroomPage.module.css';

function rankLabel(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

export function ClassroomPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [classrooms, setClassrooms] = useState(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  async function refresh() {
    try {
      const { classrooms } = await api.get('/api/classroom/me');
      setClassrooms(classrooms);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleJoin(e) {
    e.preventDefault();
    setJoining(true);
    setJoinError('');
    try {
      await api.post('/api/classroom/join', { code: code.trim() });
      setCode('');
      await refresh();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  const hasClasses = classrooms && classrooms.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/map')}>
          ← back to the map
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🏫</span>
          <h1 className={styles.title}>My Classroom</h1>
          <p className={styles.subtitle}>— see your classmates and their dragons</p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.errorNote}>Couldn’t load your classroom — {error}</p>}
        {!classrooms && !error && <p className={styles.loadingNote}>finding your classmates…</p>}

        {hasClasses && classrooms.map(room => (
          <section key={room.id} className={styles.classSection}>
            <h2 className={styles.className}>{room.name}</h2>
            <div className={styles.grid}>
              {room.classmates.map(mate => {
                const isYou = mate.id === user?.id;
                const name = mate.needs_handle ? 'New adventurer' : mate.username;
                return (
                  <button
                    key={mate.id}
                    type="button"
                    className={`${styles.mate} ${isYou ? styles.mateYou : ''}`}
                    onClick={() => { if (!isYou && !mate.needs_handle) navigate(`/classroom/student/${mate.id}`); }}
                    disabled={isYou || mate.needs_handle}
                    title={isYou ? 'That’s you!' : `See ${name}’s dragons`}
                  >
                    <span className={styles.rank}>{rankLabel(mate.rank)}</span>
                    <span className={styles.mateAvatar}>{renderAvatar(mate.avatar)}</span>
                    <span className={styles.mateName}>{isYou ? `${name} (you)` : name}</span>
                    <span className={styles.mateDragons}>🐉 {mate.dragons_collected}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {classrooms && !hasClasses && (
          <p className={styles.emptyNote}>You’re not in a class yet. Got a code from your teacher? Enter it below!</p>
        )}

        {classrooms && (
          <form onSubmit={handleJoin} className={styles.joinCard}>
            <label className={styles.joinLabel}>
              {hasClasses ? 'Join another class' : 'Join a class'}
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().slice(0, 12))}
                className={styles.joinInput}
                placeholder="CLASS CODE"
                autoComplete="off"
              />
            </label>
            {joinError && <p className={styles.errorNote}>{joinError}</p>}
            <button type="submit" className={styles.joinBtn} disabled={joining || !code.trim()}>
              {joining ? 'Joining…' : 'Join'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
