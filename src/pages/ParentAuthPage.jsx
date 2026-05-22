import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton';
import styles from '../styles/AuthPage.module.css';

export function ParentAuthPage() {
  const navigate = useNavigate();
  const { signInParent, signUpParent } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signUpParent(email.trim(), password);
      else await signInParent(email.trim(), password);
      navigate('/parent', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.page} ${styles.parent}`}>
      <div className={styles.doodleLayer} aria-hidden="true">
        <span className={`${styles.doodle} ${styles.doodleStarSage}`}>✦</span>
        <span className={`${styles.doodle} ${styles.doodleStarSky}`}>✦</span>
        <span className={`${styles.doodle} ${styles.doodleStarMust}`}>★</span>
        <span className={`${styles.doodle} ${styles.doodleSparkle}`}>· · ✦ · ·</span>
        <span className={`${styles.doodle} ${styles.doodleSparkle2}`}>· · ✦ · ·</span>
        <span className={`${styles.doodleNote} ${styles.doodleNoteTop}`}>grown-up door</span>
        <span className={`${styles.doodleNote} ${styles.doodleNoteBottom}`}>— field notes await</span>
      </div>

      <div className={styles.card}>
        <span className={styles.washiTopLeft} aria-hidden="true" />
        <span className={styles.washiTopRight} aria-hidden="true" />

        <div className={styles.logo}>
          <span className={styles.logoDragon} aria-hidden="true">🐉</span>
          <div className={styles.logoTitleWrap}>
            <h1 className={styles.logoTitle}>My Dragon Math</h1>
          </div>
          <p className={styles.logoSub}>follow your dragon-mathlete</p>
        </div>

        <h2 className={styles.formTitle}>
          {mode === 'signup' ? 'Start a grown-up journal' : 'Welcome back, grown-up'}
        </h2>

        <GoogleSignInButton onSuccess={() => navigate('/parent', { replace: true })} />

        <div className={styles.divider}><span>or</span></div>

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
          <label className={styles.label}>
            Password
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
            {busy ? 'Just a moment…' : (mode === 'signup' ? 'Open the journal' : 'Sign in')}
          </button>
        </form>

        <p className={styles.modeToggle}>
          {mode === 'login' ? (
            <>New here? <button type="button" onClick={() => { setMode('signup'); setError(null); }}>Start a grown-up journal</button></>
          ) : (
            <>Already have one? <button type="button" onClick={() => { setMode('login'); setError(null); }}>Sign in</button></>
          )}
        </p>

        <p className={styles.modeToggle}>
          <Link to="/auth">Kid sign in instead</Link>
        </p>
      </div>
    </div>
  );
}
