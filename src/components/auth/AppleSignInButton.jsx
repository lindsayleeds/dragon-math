import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { createAppleNonce } from '../../utils/appleNonce';
import styles from '../../styles/AuthPage.module.css';

export const APPLE_JS_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

// The two ways Apple's popup reports "the person backed out" — not an error
// worth showing.
const CANCELLED = new Set(['popup_closed_by_user', 'user_cancelled_authorize']);

// Sign in with Apple JS, popup mode, for the web parent sign-in (docs/adr/0007).
// Signs into the same account as the iOS app: both send Apple's identity token
// to POST /api/auth/apple, which finds the parent by Apple `sub`.
//
// Renders nothing unless VITE_APPLE_SERVICES_ID and VITE_APPLE_REDIRECT_URI are
// both set, so the page is unchanged until the Apple Developer setup in
// docs/APPLE_SIGN_IN.md is done.
//
// Each attempt gets its own nonce, prepared BEFORE the click: hashing is async,
// and awaiting it inside the click handler would let the browser treat Apple's
// popup as unrequested and block it. So `AppleID.auth.init()` is called with the
// next attempt's hashed nonce ahead of time, the click calls `signIn()`
// synchronously, and a fresh nonce is prepared after every attempt.
//
// Like GoogleSignInButton, the setup effect depends on the config alone;
// `useAuth()` returns new functions every render and callers pass an inline
// `onSuccess`, so both are read through a ref.
export function AppleSignInButton({ onSuccess }) {
  const { signInWithApple } = useAuth();
  const servicesId = import.meta.env.VITE_APPLE_SERVICES_ID;
  const redirectURI = import.meta.env.VITE_APPLE_REDIRECT_URI;
  const configured = !!(servicesId && redirectURI);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const latest = useRef({ signInWithApple, onSuccess });
  useEffect(() => { latest.current = { signInWithApple, onSuccess }; });

  // The raw nonce and state the next signIn() will be checked against.
  const attemptRef = useRef(null);

  const prepare = useCallback(async () => {
    const { raw, hashed } = await createAppleNonce();
    const state = (await createAppleNonce()).raw;
    if (!mountedRef.current || !window.AppleID?.auth) return;
    window.AppleID.auth.init({
      clientId: servicesId,
      scope: 'email',
      redirectURI,
      state,
      nonce: hashed,
      usePopup: true,
    });
    attemptRef.current = { raw, state };
    setReady(true);
  }, [servicesId, redirectURI]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const start = () => { if (!cancelled) prepare(); };
    const fail = () => { if (!cancelled) setUnavailable(true); };

    if (window.AppleID?.auth) {
      start();
    } else {
      let script = document.querySelector(`script[src="${APPLE_JS_SRC}"]`);
      if (!script) {
        script = document.createElement('script');
        script.src = APPLE_JS_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', start, { once: true });
      script.addEventListener('error', fail, { once: true });
    }
    return () => { cancelled = true; };
  }, [configured, prepare]);

  function handleClick() {
    const attempt = attemptRef.current;
    if (!attempt || !window.AppleID?.auth) return;
    attemptRef.current = null; // one nonce, one attempt
    setReady(false);
    setError(null);
    setBusy(true);
    // Called synchronously in the click so the popup isn't blocked.
    const popup = window.AppleID.auth.signIn();
    finish(popup, attempt);
  }

  async function finish(popup, attempt) {
    try {
      let response;
      try {
        response = await popup;
      } catch (err) {
        if (!CANCELLED.has(err?.error)) throw new Error('Apple sign-in did not finish. Please try again.', { cause: err });
        return;
      }
      const idToken = response?.authorization?.id_token;
      if (!idToken || response.authorization.state !== attempt.state) {
        throw new Error('Apple sign-in did not finish. Please try again.');
      }
      const user = await latest.current.signInWithApple(idToken, attempt.raw);
      latest.current.onSuccess?.(user);
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        prepare();
      }
    }
  }

  if (!configured || unavailable) return null;

  return (
    <div className={styles.appleSlot}>
      <button
        type="button"
        className={styles.appleBtn}
        onClick={handleClick}
        disabled={!ready || busy}
      >
        <svg className={styles.appleLogo} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M16.37 1.43c0 1.14-.42 2.2-1.25 3.19-1 1.17-2.21 1.84-3.52 1.74a3.54 3.54 0 0 1-.03-.43c0-1.1.48-2.27 1.33-3.23.42-.49.96-.89 1.61-1.21.65-.32 1.26-.49 1.84-.52.01.15.02.3.02.46Zm4.73 16.4c-.37.85-.8 1.64-1.31 2.36-.69.98-1.26 1.66-1.7 2.04-.68.63-1.41.95-2.19.97-.56 0-1.23-.16-2.02-.48-.79-.32-1.52-.48-2.18-.48-.7 0-1.44.16-2.24.48-.8.32-1.44.49-1.93.51-.75.03-1.5-.3-2.24-1-.48-.41-1.07-1.12-1.78-2.13a14.8 14.8 0 0 1-1.88-3.74C1.21 15.02.95 13.54.95 12.1c0-1.64.35-3.06 1.06-4.25a6.24 6.24 0 0 1 2.23-2.25 6 6 0 0 1 3.01-.85c.59 0 1.37.18 2.33.54.96.36 1.58.54 1.85.54.2 0 .89-.21 2.06-.64 1.1-.4 2.04-.56 2.8-.5 2.07.17 3.63.99 4.66 2.46-1.85 1.12-2.77 2.69-2.75 4.71.02 1.57.59 2.88 1.7 3.92.51.48 1.07.85 1.7 1.11-.14.4-.28.78-.44 1.15Z"
          />
        </svg>
        <span>{busy ? 'Waiting for Apple…' : 'Continue with Apple'}</span>
      </button>
      {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
