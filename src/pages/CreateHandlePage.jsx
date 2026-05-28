import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/AuthPage.module.css';

// First-time setup for a parent-created child: pick a handle and an avatar.
// Reached after /k/<token> login when the account still needs a handle.
export function CreateHandlePage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { createHandle } = useAuth();
  const [username, setUsername] = useState('');
  const [avatars, setAvatars] = useState([]);
  const [selected, setSelected] = useState(user?.avatar || '⚔️');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/auth/avatars')
      .then(({ avatars }) => {
        setAvatars(avatars);
        if (avatars.length) setSelected(prev => (avatars.includes(prev) ? prev : avatars[0]));
      })
      .catch(() => { /* avatar grid is optional; handle entry still works */ });
  }, []);

  // Already has a handle (or somehow not a child) → nothing to do here.
  if (user && !user.needs_handle) return <Navigate to="/map" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createHandle(username.trim(), selected);
      navigate('/map', { replace: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />

        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
          <div className={styles.logoTitleWrap}>
            <h1 className={styles.logoTitle}>Welcome, traveler!</h1>
          </div>
          <p className={styles.logoSub}>— let’s make your dragon name</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          {error && <p className={styles.error}>{error}</p>}

          <label className={styles.label}>
            Pick your traveler name
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="pick a name…"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9_\-]+"
              autoComplete="off"
              autoFocus
            />
          </label>

          {avatars.length > 0 && (
            <div className={styles.label}>
              Choose your avatar
              <div className={styles.avatarGrid}>
                {avatars.map(a => (
                  <button
                    key={a}
                    type="button"
                    className={`${styles.avatarBtn} ${a === selected ? styles.avatarBtnSelected : ''}`}
                    onClick={() => setSelected(a)}
                    aria-pressed={a === selected}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Start my adventure'}
          </button>
        </form>
      </div>
    </div>
  );
}
