import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken } from '../api';

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

  function handleAuthSuccess(token, userData) {
    setToken(token);
    setUser(userData);
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
  }

  const session = user ? { user } : null;

  return (
    <AuthContext.Provider value={{ session, user, loading, handleAuthSuccess, handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
