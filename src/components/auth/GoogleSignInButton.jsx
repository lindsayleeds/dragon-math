import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  clearPendingCredential,
  savePendingCredential,
  takePendingCredential,
} from '../../utils/pendingGoogleCredential';
import styles from '../../styles/AuthPage.module.css';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// Loads Google Identity Services on demand. Renders a Google-branded button
// inside the divRef when the client id is configured; otherwise renders a
// disabled fallback so the rest of the auth page still works in dev.
//
// The setup effect below depends on `clientId` ALONE, and that is load-bearing.
// `useAuth()` rebuilds every function it returns on each call and callers pass
// an inline arrow for `onSuccess`, so naming either in the dependency array
// re-ran this effect on every render of the auth page — each run calling
// `initialize()` + `renderButton()` again and throwing away the Google iframe
// mid-load. Measured against production: typing five characters into the email
// field aborted four `accounts.google.com/gsi/button` loads. On a slower iPad
// that churn is the button never finishing loading at all. Both values are read
// through a ref instead, which is always current by the time a user-triggered
// GSI callback can fire.
export function GoogleSignInButton({ onSuccess }) {
  const { signInWithGoogle } = useAuth();
  const divRef = useRef(null);
  const [error, setError] = useState(null);
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Refreshed after every render, so the callbacks never go stale without
  // making the setup effect re-run. No dependency array on purpose.
  const latest = useRef({ signInWithGoogle, onSuccess });
  useEffect(() => { latest.current = { signInWithGoogle, onSuccess }; });

  // Park the credential before the request leaves, so a page teardown between
  // here and the response doesn't lose the sign-in — see pendingGoogleCredential.
  const exchange = useCallback(async (credential, { alreadyStored = false } = {}) => {
    if (!credential) return;
    if (!alreadyStored) savePendingCredential(credential);
    try {
      const user = await latest.current.signInWithGoogle(credential);
      clearPendingCredential();
      latest.current.onSuccess?.(user);
    } catch (err) {
      // Only a verdict from the server spends the token, so only that erases
      // the entry. A rejection with no status never reached a response — the
      // fetch died with the page, which is the iPad teardown this parking
      // exists for — so the credential stays for the reloaded page to resume,
      // bounded by the TTL and attempt cap rather than by this catch.
      if (err?.status != null) clearPendingCredential();
      if (mountedRef.current) setError(err.message);
    }
  }, []);

  // A credential left over from a page that was torn down mid-exchange. Guarded
  // because StrictMode double-invokes effects in dev, and resuming twice would
  // spend two of the three attempts on one page load.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!clientId || resumedRef.current) return;
    resumedRef.current = true;
    const pending = takePendingCredential();
    if (pending) exchange(pending, { alreadyStored: true });
  }, [clientId, exchange]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    function init() {
      if (cancelled || !window.google?.accounts?.id || !divRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => { exchange(response.credential); },
      });
      window.google.accounts.id.renderButton(divRef.current, {
        theme: 'outline',
        size: 'medium',
        shape: 'pill',
        width: 240,
        text: 'continue_with',
      });
    }

    if (window.google?.accounts?.id) {
      init();
    } else {
      const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', init, { once: true });
      } else {
        const s = document.createElement('script');
        s.src = GSI_SRC;
        s.async = true;
        s.defer = true;
        s.onload = init;
        document.head.appendChild(s);
      }
    }
    return () => { cancelled = true; };
  }, [clientId, exchange]);

  if (!clientId) {
    return (
      <div className={styles.googleStamp}>
        <span className={styles.googleStampWashiL} aria-hidden="true" />
        <span className={styles.googleStampWashiR} aria-hidden="true" />
        <p className={styles.googleStampLabel}>or use your Google account</p>
        <button type="button" className={styles.googleBtn} disabled>
          <span>🔒</span><span>Sign in with Google</span>
        </button>
        <p className={styles.googleBtnHint}>Set <code>VITE_GOOGLE_OAUTH_CLIENT_ID</code> to enable.</p>
      </div>
    );
  }

  return (
    <div className={styles.googleStamp}>
      <span className={styles.googleStampWashiL} aria-hidden="true" />
      <span className={styles.googleStampWashiR} aria-hidden="true" />
      <p className={styles.googleStampLabel}>or use your Google account</p>
      <div ref={divRef} className={styles.googleStampSlot} />
      {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
