import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api';
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton';
import styles from '../styles/AuthPage.module.css';

function planLabel(plan) {
  if (plan === 'classroom') return 'Classroom';
  if (plan === 'premium') return 'Premium';
  return 'Free';
}

export function ParentAuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signInParent, signUpParent } = useAuth();
  // A "lifetime free" comp invite arrives as ?comp=<token>. We validate it and,
  // if good, force signup mode with the invite's role and pass the token through
  // so the new account is comped server-side.
  const compToken = searchParams.get('comp') || '';
  const [invite, setInvite] = useState(null); // { valid, role, plan } | { valid:false } | null(=loading)
  // The landing's "I'm a classroom teacher" button links here with
  // ?role=teacher&mode=signup so the form opens straight on teacher signup.
  const [mode, setMode] = useState(
    compToken || searchParams.get('mode') === 'signup' ? 'signup' : 'login',
  ); // 'login' | 'signup'
  const [role, setRole] = useState(searchParams.get('role') === 'teacher' ? 'teacher' : 'parent'); // 'parent' | 'teacher' (signup only)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!compToken) return;
    let cancelled = false;
    api.get(`/api/auth/comp-invite/${encodeURIComponent(compToken)}`)
      .then(res => {
        if (cancelled) return;
        setInvite(res);
        if (res.valid) { setMode('signup'); setRole(res.role); }
      })
      .catch(() => { if (!cancelled) setInvite({ valid: false }); });
    return () => { cancelled = true; };
  }, [compToken]);

  const compActive = !!compToken && invite?.valid === true;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let user;
      if (mode === 'signup') {
        user = await signUpParent(email.trim(), password, role, compActive ? compToken : null);
      } else {
        user = await signInParent(email.trim(), password);
      }
      navigate(user?.adult_role === 'teacher' ? '/teacher' : '/parent', { replace: true });
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

        {compToken && invite && (
          invite.valid ? (
            <div className={styles.compBanner} role="status">
              <span className={styles.compBannerIcon} aria-hidden>🐉✨</span>
              <div>
                <strong>You&rsquo;ve been gifted a lifetime-free account!</strong>
                <p>
                  Finish signing up below and your {invite.role === 'teacher' ? 'classroom' : 'family'} plan
                  ({planLabel(invite.plan)}) is yours for good — no card, no expiry.
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.compBannerStale} role="status">
              This invitation link is no longer valid — it may have already been used.
              You can still create a regular account below.
            </div>
          )
        )}

        <h2 className={styles.formTitle}>
          {mode === 'signup'
            ? (role === 'teacher' ? 'Create Teacher Account' : 'Create Parent Account')
            : 'Welcome back, grown-up'}
        </h2>

        {mode === 'signup' && !compActive && (
          <div className={styles.roleToggle} role="radiogroup" aria-label="Account type">
            <button
              type="button"
              role="radio"
              aria-checked={role === 'parent'}
              className={`${styles.roleBtn} ${role === 'parent' ? styles.roleBtnActive : ''}`}
              onClick={() => setRole('parent')}
            >
              <span className={styles.roleIcon} aria-hidden>👪</span>
              Parent / guardian
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={role === 'teacher'}
              className={`${styles.roleBtn} ${role === 'teacher' ? styles.roleBtnActive : ''}`}
              onClick={() => setRole('teacher')}
            >
              <span className={styles.roleIcon} aria-hidden>🍎</span>
              Teacher
            </button>
          </div>
        )}

        {!compActive && (
          <>
            <GoogleSignInButton onSuccess={() => navigate('/parent', { replace: true })} />
            <div className={styles.divider}><span>or</span></div>
          </>
        )}

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
          {/* Shown at the point of consent, not buried in a footer — this is the
              moment an adult takes responsibility for a child's account. */}
          {mode === 'signup' && (
            <p className={styles.legalConsent}>
              By creating an account you agree to our{' '}
              <Link to="/terms">Terms of Service</Link> and{' '}
              <Link to="/privacy">Privacy Policy</Link>.
            </p>
          )}
          <button type="submit" className={styles.button} disabled={busy}>
            {busy ? 'Just a moment…' : (mode === 'signup' ? 'Open the journal' : 'Sign in')}
          </button>
        </form>

        {mode === 'login' && (
          <p className={styles.modeToggle}>
            <Link to="/parent/forgot">Forgot your password?</Link>
          </p>
        )}

        <p className={styles.modeToggle}>
          {mode === 'login' ? (
            <>New here? <button type="button" onClick={() => { setMode('signup'); setError(null); }}>Create an account</button></>
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
