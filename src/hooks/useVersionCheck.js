import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 60_000;

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const current = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
    if (!current?.commit) return;

    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setLatest(data);
        if (data.commit && data.commit !== current.commit) {
          setUpdateAvailable(true);
        }
      } catch {
        // network blip — try again next tick
      }
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  return { updateAvailable, latest, reload: () => window.location.reload() };
}
