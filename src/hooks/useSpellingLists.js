import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

// Load a child's custom Dragon Spelling lists ("Week 1", "Week 2", …).
//
// `childId` null means "the signed-in child's own lists" — the server scopes to
// the session. An adult passes a linked child's id. Set `enabled: false` to skip
// the fetch entirely (guest sessions have no rows to read).
//
// `refresh()` bumps a token rather than re-running the fetch directly: every
// setState here happens after an await, inside the request's own continuation,
// which is what keeps the effect off react-hooks/set-state-in-effect. `loading`
// therefore covers the FIRST load only — a refresh after a save or delete swaps
// the rows in without flashing the list back to a spinner.
export function useSpellingLists(childId, { enabled = true } = {}) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    // Guards against a response landing after unmount, or after `childId` has
    // moved on — the later request wins and the stale one is dropped.
    let cancelled = false;

    (async () => {
      try {
        const query = childId ? `?child_id=${childId}` : '';
        const data = await api.get(`/api/spelling/lists${query}`);
        if (cancelled) return;
        setLists(data.lists || []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [childId, enabled, reloadToken]);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  return { lists, loading, error, refresh };
}
