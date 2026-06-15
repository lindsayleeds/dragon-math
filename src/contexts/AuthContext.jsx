import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, setGuestMode } from '../api';
import { applyFontTheme } from '../utils/fontTheme';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('dm_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/api/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // Re-apply the saved font combo whenever the user (re)loads or changes it.
  // Falls back to the default theme for parents / signed-out / no preference.
  useEffect(() => {
    applyFontTheme(user?.font);
  }, [user?.font]);

  function handleAuthSuccess(token, userData) {
    setGuestMode(false);
    setToken(token);
    setUser(userData);
  }

  // Start an ephemeral guest session: no token, in-memory user only, so it is
  // discarded on refresh. The api client answers auth-required calls locally.
  function enterGuest() {
    setGuestMode(true);
    setUser({
      account_type: 'guest',
      username: 'Guest',
      current_node_id: 1,
      avatar: '⚔️',
      font: 'handwritten',
      is_guest: true,
    });
  }

  function handleLogout() {
    setGuestMode(false);
    setToken(null);
    setUser(null);
  }

  function updateUser(userData) {
    setUser(prev => ({ ...prev, ...userData }));
  }

  const session = user ? { user } : null;
  const isGuest = user?.account_type === 'guest';

  return (
    <AuthContext.Provider value={{ session, user, loading, isGuest, handleAuthSuccess, enterGuest, handleLogout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
