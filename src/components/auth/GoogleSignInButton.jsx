import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from '../../styles/AuthPage.module.css';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// Loads Google Identity Services on demand. Renders a Google-branded button
// inside the divRef when the client id is configured; otherwise renders a
// disabled fallback so the rest of the auth page still works in dev.
export function GoogleSignInButton({ onSuccess }) {
  const { signInWithGoogle } = useAuth();
  const divRef = useRef(null);
  const [error, setError] = useState(null);
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    function init() {
      if (cancelled || !window.google?.accounts?.id || !divRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            await signInWithGoogle(response.credential);
            onSuccess?.();
          } catch (err) {
            setError(err.message);
          }
        },
      });
      window.google.accounts.id.renderButton(divRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
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
  }, [clientId, signInWithGoogle, onSuccess]);

  if (!clientId) {
    return (
      <>
        <button type="button" className={styles.googleBtn} disabled>
          <span>🔒</span><span>Sign in with Google</span>
        </button>
        <p className={styles.googleBtnHint}>Set <code>VITE_GOOGLE_OAUTH_CLIENT_ID</code> to enable.</p>
      </>
    );
  }

  return (
    <>
      <div ref={divRef} style={{ display: 'flex', justifyContent: 'center' }} />
      {error && <p className={styles.error} style={{ marginTop: '0.5rem' }}>{error}</p>}
    </>
  );
}
