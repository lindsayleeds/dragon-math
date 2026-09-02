import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/FamilyLinkPage.module.css';

export function FamilyLinkPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { loginWithFamilyToken } = useAuth();
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/auth/family/${encodeURIComponent(token)}`)
      .then(({ children }) => { if (!cancelled) setChildren(children); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function chooseChild(child) {
    setBusyId(child.id);
    setError(null);
    try {
      const user = await loginWithFamilyToken(token, child.id);
      navigate(user.needs_handle ? '/welcome' : '/home', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <span className={styles.tape} aria-hidden />
        <div className={styles.dragon} aria-hidden>🐉</div>
        <h1>Who’s ready to play?</h1>
        <p className={styles.intro}>Choose your adventurer to open their own Dragon Math journey.</p>
        {loading ? (
          <p className={styles.status}>Gathering your family…</p>
        ) : children.length > 0 ? (
          <div className={styles.kidGrid}>
            {children.map(child => (
              <button
                key={child.id}
                type="button"
                className={styles.kidButton}
                onClick={() => chooseChild(child)}
                disabled={busyId !== null}
              >
                <span className={styles.avatar}>{renderAvatar(child.avatar)}</span>
                <span>{child.needs_handle ? 'New traveler' : child.username}</span>
                {busyId === child.id && <small>Opening…</small>}
              </button>
            ))}
          </div>
        ) : !error ? (
          <p className={styles.status}>No adventurers are linked to this family yet.</p>
        ) : null}
        {error && <p className={styles.error}>{error}</p>}
      </main>
    </div>
  );
}
