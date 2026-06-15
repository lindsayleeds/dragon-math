import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/GuestBanner.module.css';

// A gentle nudge shown while playing as a guest: progress isn't saved, so
// invite a grown-up to sign up. Dismissible for the rest of the session.
export function GuestBanner() {
  const { isGuest } = useAuthContext();
  const [dismissed, setDismissed] = useState(false);

  if (!isGuest || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>
        🐉 Playing as a guest — progress won't be saved. Ask a grown-up to{' '}
        <Link to="/parent/auth" className={styles.link}>sign up</Link> to keep your dragons!
      </span>
      <button
        type="button"
        className={styles.close}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
