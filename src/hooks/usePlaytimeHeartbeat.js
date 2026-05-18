import { useEffect } from 'react';
import { api } from '../api';

const HEARTBEAT_MS = 20_000;

// Pings the server every ~20s while the page is visible, recording one
// "minute played" per local minute. Pings immediately on mount and again
// when the tab returns to visible, so short visits and post-sleep returns
// are both counted. Pause is implicit: hidden tab → no pings → no minutes.
export function usePlaytimeHeartbeat(active = true) {
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let intervalId = null;

    function ping() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      api.post('/api/playtime/heartbeat', {}).catch(() => {
        // Heartbeat is best-effort; swallow network errors silently.
      });
    }

    function start() {
      ping();
      intervalId = setInterval(ping, HEARTBEAT_MS);
    }
    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        stop();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);
}
