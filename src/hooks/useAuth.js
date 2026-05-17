import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';

export function useAuth() {
  const { handleAuthSuccess, handleLogout } = useAuthContext();

  async function login(email, password) {
    const { token, user } = await api.post('/api/auth/login', { email, password });
    handleAuthSuccess(token, user);
    return user;
  }

  async function signup(email, password, displayName) {
    const { token, user } = await api.post('/api/auth/signup', {
      email,
      password,
      display_name: displayName,
    });
    handleAuthSuccess(token, user);
    return user;
  }

  async function logout() {
    handleLogout();
  }

  return { login, signup, logout };
}
