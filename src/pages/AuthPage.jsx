import { Link } from 'react-router-dom';
import { SignInForm } from '../components/auth/SignInForm';
import styles from '../styles/AuthPage.module.css';

export function AuthPage() {
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
        <span className={`${styles.doodleNote} ${styles.doodleNoteBottom}`}>— sign in here</span>
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

        <SignInForm />

        <p className={styles.modeToggle}>
          <Link to="/parent/auth">Grown-up? Sign in here</Link>
        </p>
      </div>
    </div>
  );
}
