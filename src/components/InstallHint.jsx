import { useEffect, useState } from 'react';

const DISMISS_KEY = 'dm-install-hint-dismissed';

// True when the app is already running from the home screen (no browser chrome).
function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Prompts the player to add Dragon Math to their home screen so it runs full
// screen (no Safari/Chrome bars). On Android/desktop Chrome we get a real
// install prompt via `beforeinstallprompt`; on iOS there's no such API, so we
// show the manual Share -> Add to Home Screen steps instead.
export function InstallHint() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    // Android / desktop Chrome: capture the install prompt for a one-tap button.
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS never fires that event — show manual instructions on Apple devices.
    if (isIos()) setShow(true);

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(92vw, 420px)',
        background: '#fff8ec',
        color: '#3a2f1c',
        padding: '12px 14px',
        borderRadius: 14,
        border: '2px solid #e0c9a0',
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        lineHeight: 1.35,
      }}
      role="status"
    >
      <span style={{ fontSize: 26 }} aria-hidden="true">
        🐲
      </span>
      <div style={{ flex: 1 }}>
        {deferredPrompt ? (
          <span>Add Dragon Math to your home screen to play full screen!</span>
        ) : (
          <span>
            Play full screen! Tap the <strong>Share</strong> button{' '}
            <span aria-hidden="true">⬆️</span>, then <strong>Add to Home Screen</strong>.
          </span>
        )}
      </div>
      {deferredPrompt && (
        <button
          type="button"
          onClick={install}
          style={{
            background: '#5a8f3c',
            color: '#fff',
            border: 'none',
            padding: '8px 14px',
            borderRadius: 10,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Add
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#8a7a5c',
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
