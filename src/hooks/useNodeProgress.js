import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';

// Module-level cache so navigating back to a page that uses progress (e.g. the
// Adventure Map → home) renders instantly from the last-known data instead of
// blocking behind a fresh /api/progress round-trip. The hook still revalidates
// in the background on every mount, so the cache is only ever briefly stale.
const cache = {
  userKey: null,
  progressMap: {},
  currentNodeId: 1,
  username: 'Dragon Tamer',
};

export function useNodeProgress() {
  const { user } = useAuthContext();
  // Only trust the cache if it belongs to the kid currently logged in, so a
  // different kid (or a fresh login) never briefly sees someone else's quests.
  const cacheValid = cache.userKey != null && cache.userKey === user?.username;
  const [progressMap, setProgressMap] = useState(cacheValid ? cache.progressMap : {});
  const [currentNodeId, setCurrentNodeId] = useState(cacheValid ? cache.currentNodeId : 1);
  const [username, setUsername] = useState(cacheValid ? cache.username : 'Dragon Tamer');
  const [loading, setLoading] = useState(!cacheValid);

  const fetchProgress = useCallback(async () => {
    if (!user) return;
    try {
      const { current_node_id, username, progress } = await api.get('/api/progress');
      const map = {};
      progress.forEach(r => {
        map[r.node_id] = { completed: Boolean(r.completed), stars: r.stars, completed_at: r.completed_at };
      });
      setCurrentNodeId(current_node_id);
      setUsername(username);
      setProgressMap(map);
      cache.userKey = user.username;
      cache.currentNodeId = current_node_id;
      cache.username = username;
      cache.progressMap = map;
    } catch (err) {
      console.error('Failed to fetch progress:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  async function markNodeComplete(nodeId, stars = 3) {
    if (!user) return;
    try {
      await api.put(`/api/progress/${nodeId}`, { stars });
      setProgressMap(prev => {
        const next = { ...prev, [nodeId]: { completed: true, stars, completed_at: new Date().toISOString() } };
        cache.progressMap = next;
        return next;
      });
      setCurrentNodeId(prev => {
        const next = Math.max(prev, nodeId + 1);
        cache.currentNodeId = next;
        return next;
      });
      cache.userKey = user.username;
    } catch (err) {
      console.error('Failed to mark node complete:', err);
    }
  }

  return { progressMap, currentNodeId, username, loading, markNodeComplete, refetch: fetchProgress };
}
