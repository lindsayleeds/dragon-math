import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { homePathFor } from '../utils/homePath';
import styles from '../styles/GuestBanner.module.css';

// A gentle nudge shown while playing as a guest: progress isn't saved, so
// invite a grown-up to sign up. Dismissible for the rest of the session.
// When a teacher/parent is in "test the games" mode we instead show a persistent
// banner with an Exit button that hops back to their dashboard.
export function GuestBanner() {
  const { isGuest, isTesting, exitTestMode } = useAuthContext();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [exiting, setExiting] = useState(false);

  if (isTesting) {
    async function handleExit() {
      setExiting(true);
      const user = await exitTestMode();
      navigate(homePathFor(user));
    }

    return (
      <div className={`${styles.banner} ${styles.testBanner}`} role="status">
        <span className={styles.text}>
          🧪 Test mode — you're playing as a student. Nothing you do here is saved.
        </span>
        <button
          type="button"
          className={styles.exitBtn}
          onClick={handleExit}
          disabled={exiting}
        >
          {exiting ? 'Exiting…' : 'Exit test mode'}
        </button>
      </div>
    );
  }

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
