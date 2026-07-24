import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/AuthPage.module.css';

// Public page reached from the verification email: /parent/verify?token=<raw>.
// Redeems the token on mount and reports success/failure. If the visitor happens
// to be signed in, refresh their session flag so the dashboard banner clears.
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { verifyEmail } = useAuth();
  const { user, updateUser } = useAuthContext();
  const [status, setStatus] = useState(token ? 'working' : 'error');
  const [error, setError] = useState('This confirmation link is invalid or has expired.');
  const ranRef = useRef(false);

  useEffect(() => {
    if (!token || ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await verifyEmail(token);
        if (cancelled) return;
        setStatus('ok');
        if (user?.account_type === 'parent') updateUser({ email_verified: true });
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const homeHref = user?.account_type === 'parent'
    ? (user?.adult_role === 'teacher' ? '/teacher' : '/parent')
    : '/parent/auth';

  return (
    <div className={`${styles.page} ${styles.parent}`}>
      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />
        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
        </div>

        {status === 'working' && <h2 className={styles.formTitle}>Confirming your email…</h2>}

        {status === 'ok' && (
          <>
            <h2 className={styles.formTitle}>Email confirmed! 🎉</h2>
            <p className={styles.centerNote}>Thanks — your email is verified.</p>
            <p className={styles.modeToggle}>
              <Link to={homeHref}>{user?.account_type === 'parent' ? 'Back to your dashboard' : 'Sign in'}</Link>
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className={styles.formTitle}>We couldn&rsquo;t confirm that</h2>
            <p className={styles.error}>{error}</p>
            <p className={styles.centerNote}>
              The link may have expired. You can send yourself a fresh one from your dashboard.
            </p>
            <p className={styles.modeToggle}>
              <Link to={homeHref}>{user?.account_type === 'parent' ? 'Back to your dashboard' : 'Sign in'}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
