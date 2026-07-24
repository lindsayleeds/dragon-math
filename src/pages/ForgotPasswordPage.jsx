import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/AuthPage.module.css';

// Public "forgot password" request page. The server always responds the same way
// (whether or not the email has an account), so on success we always show the
// same "check your email" confirmation — we never reveal whether the email exists.
export function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
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

        {sent ? (
          <>
            <h2 className={styles.formTitle}>Check your email</h2>
            <p className={styles.centerNote}>
              If an account exists for <strong>{email.trim()}</strong>, we&rsquo;ve sent a link to
              reset your password. It expires in an hour.
            </p>
            <p className={styles.modeToggle}>
              <Link to="/parent/auth">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.formTitle}>Forgot your password?</h2>
            <p className={styles.centerNote}>
              Enter your email and we&rsquo;ll send you a link to choose a new one.
            </p>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className={styles.input}
                  placeholder="you@somewhere.cozy"
                />
              </label>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className={styles.button} disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className={styles.modeToggle}>
              <Link to="/parent/auth">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
