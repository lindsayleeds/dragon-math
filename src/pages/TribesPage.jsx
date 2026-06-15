import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/ClassroomPage.module.css';
import tribe from '../styles/TribesPage.module.css';

function rankLabel(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// A kid's tribes — the kid-owned mirror of the classroom page. Kids can create a
// tribe, join one by code, see each tribe's ranked roster, and open a tribemate's
// (collected-only) dragon den.
export function TribesPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [tribes, setTribes] = useState(null);
  const [error, setError] = useState('');

  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function refresh() {
    try {
      const { tribes } = await api.get('/api/tribes/me');
      setTribes(tribes);
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
      await api.post('/api/tribes/join', { code: code.trim() });
      setCode('');
      await refresh();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await api.post('/api/tribes', { name: name.trim() });
      setName('');
      await refresh();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(tribeId) {
    try {
      await api.post(`/api/tribes/${tribeId}/rotate-code`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(tribeId) {
    if (!window.confirm('Disband this tribe? Everyone will be removed.')) return;
    try {
      await api.delete(`/api/tribes/${tribeId}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLeave(tribeId) {
    if (!window.confirm('Leave this tribe?')) return;
    try {
      await api.post(`/api/tribes/${tribeId}/leave`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  const hasTribes = tribes && tribes.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate('/map')}>
          ← back to the map
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🏕️</span>
          <h1 className={styles.title}>My Tribes</h1>
          <p className={styles.subtitle}>— team up with friends and see their dragons</p>
        </div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.errorNote}>Couldn’t load your tribes — {error}</p>}
        {!tribes && !error && <p className={styles.loadingNote}>gathering your tribe…</p>}

        {hasTribes && tribes.map(group => (
          <section key={group.id} className={styles.classSection}>
            <div className={tribe.tribeHead}>
              <h2 className={styles.className}>{group.name}</h2>
              {group.is_owner
                ? <span className={tribe.ownerBadge}>you lead this tribe</span>
                : (
                  <button type="button" className={tribe.miniBtn} onClick={() => handleLeave(group.id)}>
                    Leave
                  </button>
                )}
            </div>

            <div className={tribe.codeRow}>
              <span className={tribe.codeLabel}>Invite code</span>
              <span className={tribe.codeChip}>{group.join_code}</span>
              {group.is_owner && (
                <>
                  <button type="button" className={tribe.miniBtn} onClick={() => handleRotate(group.id)}>
                    New code
                  </button>
                  <button
                    type="button"
                    className={`${tribe.miniBtn} ${tribe.dangerBtn}`}
                    onClick={() => handleDelete(group.id)}
                  >
                    Disband
                  </button>
                </>
              )}
            </div>

            <div className={styles.grid}>
              {group.members.map(mate => {
                const isYou = mate.id === user?.id;
                const mateName = mate.needs_handle ? 'New adventurer' : mate.username;
                return (
                  <button
                    key={mate.id}
                    type="button"
                    className={`${styles.mate} ${isYou ? styles.mateYou : ''}`}
                    onClick={() => { if (!isYou && !mate.needs_handle) navigate(`/tribes/member/${mate.id}`); }}
                    disabled={isYou || mate.needs_handle}
                    title={isYou ? 'That’s you!' : `See ${mateName}’s dragons`}
                  >
                    <span className={styles.rank}>{rankLabel(mate.rank)}</span>
                    <span className={styles.mateAvatar}>{renderAvatar(mate.avatar)}</span>
                    <span className={styles.mateName}>{isYou ? `${mateName} (you)` : mateName}</span>
                    <span className={styles.mateDragons}>🐉 {mate.dragons_collected}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {tribes && !hasTribes && (
          <p className={styles.emptyNote}>You’re not in a tribe yet. Start one below, or join a friend’s with their code!</p>
        )}

        {tribes && (
          <>
            <form onSubmit={handleCreate} className={styles.joinCard}>
              <label className={styles.joinLabel}>
                Start a new tribe
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value.slice(0, 40))}
                  className={styles.joinInput}
                  placeholder="Tribe name"
                  autoComplete="off"
                />
              </label>
              {createError && <p className={styles.errorNote}>{createError}</p>}
              <button type="submit" className={styles.joinBtn} disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create tribe'}
              </button>
            </form>

            <form onSubmit={handleJoin} className={styles.joinCard}>
              <label className={styles.joinLabel}>
                Join a friend’s tribe
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase().slice(0, 12))}
                  className={styles.joinInput}
                  placeholder="TRIBE CODE"
                  autoComplete="off"
                />
              </label>
              {joinError && <p className={styles.errorNote}>{joinError}</p>}
              <button type="submit" className={styles.joinBtn} disabled={joining || !code.trim()}>
                {joining ? 'Joining…' : 'Join'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
