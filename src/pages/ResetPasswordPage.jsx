import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/AuthPage.module.css';

// Public page reached from the reset email: /parent/reset?token=<raw>. Sets a new
// password and, on success, signs the user in and drops them on their dashboard.
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await resetPassword(token, password);
      navigate(user?.adult_role === 'teacher' ? '/teacher' : '/parent', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.page} ${styles.parent}`}>
      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />
        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
        </div>

        {!token ? (
          <>
            <h2 className={styles.formTitle}>This link looks broken</h2>
            <p className={styles.centerNote}>
              Please open the most recent reset link from your email, or request a new one.
            </p>
            <p className={styles.modeToggle}>
              <Link to="/parent/forgot">Request a new link</Link>
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.formTitle}>Choose a new password</h2>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  required
                  className={styles.input}
                  placeholder="at least 8 characters"
                />
              </label>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className={styles.button} disabled={busy}>
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
            <p className={styles.modeToggle}>
              <Link to="/parent/forgot">Request a new link</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
