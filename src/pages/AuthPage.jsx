import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { homePathFor } from '../utils/homePath';
import styles from '../styles/AuthPage.module.css';

// Which route chunk the next tap needs, keyed by the path the router will send
// this user to. Specifiers match the lazyPage bindings in src/App.jsx, so these
// warm the exact same chunks instead of creating new ones — and they stay
// dynamic, since a top-level page import would pull it into the entry chunk.
const ROUTE_WARMUPS = {
  '/home': [() => import('./HomePage'), () => import('./MapPagePaper')],
  '/welcome': [() => import('./CreateHandlePage')],
  '/parent': [() => import('./ParentDashboardPage')],
  '/teacher': [() => import('./TeacherDashboardPage')],
  '/parent/auth': [() => import('./ParentAuthPage')],
};

// homePathFor doesn't know about needs_handle, but RequireKid bounces a
// parent-created kid to /welcome before any hub renders — and a lazy route only
// fetches its chunk once it actually renders, so follow the guard.
function warmupPathFor(user) {
  return user?.needs_handle ? '/welcome' : homePathFor(user);
}

export function AuthPage() {
  const navigate = useNavigate();
  const { logout, playAsGuest } = useAuth();
  const { user, loading, session } = useAuthContext();

  // Every visit starts here, so warm the chunk the next tap actually needs
  // while the screen is idle — signed-in kids get the hub, adults their
  // dashboard, the signed-out chooser the adult sign-in it mostly leads to.
  // Reading the target from homePathFor keeps this from disagreeing with the
  // route guards in App.jsx and from downloading chunks nobody will open.
  const warmupPath = loading ? null : session ? warmupPathFor(user) : '/parent/auth';

  useEffect(() => {
    if (!warmupPath) return undefined;
    // Skip while offline: a rejected import() is remembered by the browser's
    // module map, so a warm-up that fails leaves the real navigation rejecting
    // instantly. RouteErrorBoundary still recovers that with one reload, but
    // not spending the failed fetch is better than needing the recovery.
    if (navigator.onLine === false) return undefined;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      for (const load of ROUTE_WARMUPS[warmupPath] ?? []) load().catch(() => {});
    };
    // iOS Safari has no requestIdleCallback, and this ships as a PWA there.
    const idleId = window.requestIdleCallback?.(warm, { timeout: 2000 });
    const timerId = idleId === undefined ? setTimeout(warm, 1200) : undefined;
    return () => {
      cancelled = true;
      if (idleId === undefined) clearTimeout(timerId);
      else window.cancelIdleCallback?.(idleId);
    };
  }, [warmupPath]);

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
