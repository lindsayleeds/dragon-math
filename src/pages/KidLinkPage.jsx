import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/AuthPage.module.css';

// Public landing for a child's permanent "login by URL" (/k/<token>). Exchanges
// the GUID for a session, then routes to handle setup (first time) or the map.
export function KidLinkPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState(null);
  // StrictMode mounts effects twice in dev; guard so we only log in once.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const user = await loginWithToken(token);
        if (cancelled) return;
        navigate(user.needs_handle ? '/welcome' : '/map', { replace: true });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />
        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
        </div>
        {error ? (
          <>
            <h2 className={styles.formTitle}>Hmm, that link didn’t work</h2>
            <p className={styles.error}>{error}</p>
            <p className={styles.centerNote}>Ask your grown-up to show you your dragon link again.</p>
          </>
        ) : (
          <h2 className={styles.formTitle}>Opening your adventure…</h2>
        )}
      </div>
    </div>
  );
}
