import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { getCompanion } from '../data/companions';
import { useAuthContext } from './AuthContext';

const CompanionContext = createContext(null);

export function CompanionProvider({ children }) {
  const { user } = useAuthContext();
  const [owned, setOwned] = useState([]);
  const [activeId, setActiveId] = useState('pip');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setOwned([]);
      setActiveId('pip');
      setLoading(false);
      return;
    }
    try {
      const { owned, active_companion_id } = await api.get('/api/companions');
      setOwned(owned);
      setActiveId(active_companion_id || 'pip');
    } catch (err) {
      console.error('Failed to fetch companions:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const capture = useCallback(async (companionId) => {
    const { owned, active_companion_id } = await api.post('/api/companions/capture', { companion_id: companionId });
    setOwned(owned);
    setActiveId(active_companion_id || 'pip');
  }, []);

  const setActive = useCallback(async (companionId) => {
    const { active_companion_id } = await api.put('/api/companions/active', { companion_id: companionId });
    setActiveId(active_companion_id);
  }, []);

  const ownsCompanion = useCallback((id) => owned.some(o => o.companion_id === id), [owned]);

  const activeCompanion = getCompanion(activeId);

  return (
    <CompanionContext.Provider value={{
      owned, activeId, activeCompanion, loading,
      refresh, capture, setActive, ownsCompanion,
    }}>
      {children}
    </CompanionContext.Provider>
  );
}

export function useCompanionContext() {
  return useContext(CompanionContext);
}
