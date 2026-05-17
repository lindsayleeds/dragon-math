import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';

export function useNodeProgress() {
  const { user } = useAuthContext();
  const [progressMap, setProgressMap] = useState({});
  const [currentNodeId, setCurrentNodeId] = useState(1);
  const [displayName, setDisplayName] = useState('Dragon Tamer');
  const [loading, setLoading] = useState(true);

  const fetchProgress = useCallback(async () => {
    if (!user) return;
    try {
      const { current_node_id, display_name, progress } = await api.get('/api/progress');
      setCurrentNodeId(current_node_id);
      setDisplayName(display_name);
      const map = {};
      progress.forEach(r => {
        map[r.node_id] = { completed: Boolean(r.completed), stars: r.stars, completed_at: r.completed_at };
      });
      setProgressMap(map);
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
      setProgressMap(prev => ({
        ...prev,
        [nodeId]: { completed: true, stars, completed_at: new Date().toISOString() },
      }));
      setCurrentNodeId(prev => Math.max(prev, nodeId + 1));
    } catch (err) {
      console.error('Failed to mark node complete:', err);
    }
  }

  return { progressMap, currentNodeId, displayName, loading, markNodeComplete, refetch: fetchProgress };
}
