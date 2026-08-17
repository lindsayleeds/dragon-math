import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

// Load a child's custom Dragon Spelling lists ("Week 1", "Week 2", …).
//
// `childId` null means "the signed-in child's own lists" — the server scopes to
// the session. An adult passes a linked child's id. Set `enabled: false` to skip
// the fetch entirely (guest sessions have no rows to read).
export function useSpellingLists(childId, { enabled = true } = {}) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const query = childId ? `?child_id=${childId}` : '';
      const data = await api.get(`/api/spelling/lists${query}`);
      setLists(data.lists || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [childId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { lists, loading, error, refresh };
}
