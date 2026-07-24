import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { homePathFor } from '../utils/homePath';
import styles from '../styles/AuthPage.module.css';

export function AuthPage() {
  const navigate = useNavigate();
  const { logout, playAsGuest } = useAuth();
  const { user, loading, session } = useAuthContext();

  // Every visit starts here, and the next tap is always a hub. Warm just those
  // two route chunks while the screen is idle so the first hop off /auth isn't
  // a blocking fetch on slow classroom wifi. Same specifiers as App.jsx, so
  // this warms the same chunks instead of creating new ones.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // A failed prefetch must be silent: the route's own lazy() import retries.
      import('./HomePage').catch(() => {});
      import('./MapPagePaper').catch(() => {});
    };
    // iOS Safari has no requestIdleCallback, and this ships as a PWA there.
    const idleId = window.requestIdleCallback?.(warm, { timeout: 2000 });
    const timerId = idleId === undefined ? setTimeout(warm, 1200) : undefined;
    return () => {
      cancelled = true;
      if (idleId === undefined) clearTimeout(timerId);
      else window.cancelIdleCallback?.(idleId);
    };
  }, [loading]);

  if (loading) return <div className="loading-screen">Loading...</div>;

  function handleGuest() {
    playAsGuest();
    navigate('/home');
  }

  async function handleLogout() {
    await logout();
  }

  return (
    <div className={styles.page}>
      <div className={styles.doodleLayer} aria-hidden="true">
        <span className={`${styles.doodle} ${styles.doodleStarRose}`}>✦</span>
        <span className={`${styles.doodle} ${styles.doodleStarSky}`}>✦</span>
        <span className={`${styles.doodle} ${styles.doodleStarMust}`}>★</span>
        <span className={`${styles.doodle} ${styles.doodleStarSage}`}>✦</span>
        <span className={`${styles.doodle} ${styles.doodleSparkle}`}>· · ✦ · ·</span>
        <span className={`${styles.doodle} ${styles.doodleSparkle2}`}>· · ✦ · ·</span>
        <span className={`${styles.doodleNote} ${styles.doodleNoteTop}`}>chapter one</span>
        <span className={`${styles.doodleNote} ${styles.doodleNoteBottom}`}>— begin here</span>
      </div>

      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />

        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
          <div className={styles.logoTitleWrap}>
            <h1 className={styles.logoTitle}>My Dragon Math</h1>
          </div>
          <p className={styles.logoSub}>— a hand-drawn adventure</p>
        </div>

        {session ? (
          <div className={styles.welcomeBack}>
            <h2 className={styles.formTitle}>Welcome back, {user.username}!</h2>
            <button
              type="button"
              className={styles.button}
              onClick={() => navigate(homePathFor(user))}
            >
              Tap to enter
            </button>
            <p className={styles.modeToggle}>
              Not you? <button type="button" onClick={handleLogout}>Log out</button>
            </p>
          </div>
        ) : (
          <div className={styles.chooser}>
            <h2 className={styles.formTitle}>Who's adventuring today?</h2>
            <button
              type="button"
              className={styles.choiceBtn}
              onClick={() => navigate('/parent/auth')}
            >
              <span className={styles.choiceIcon} aria-hidden>👪</span>
              I'm a parent / guardian
            </button>
            <button
              type="button"
              className={styles.choiceBtn}
              onClick={() => navigate('/parent/auth?role=teacher&mode=signup')}
            >
              <span className={styles.choiceIcon} aria-hidden>🍎</span>
              I'm a classroom teacher
            </button>
            <button
              type="button"
              className={styles.guestBtn}
              onClick={handleGuest}
            >
              Play as guest
            </button>
            <p className={styles.switchText}>
              Guest play isn't saved — sign up to keep your dragons and track progress.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
