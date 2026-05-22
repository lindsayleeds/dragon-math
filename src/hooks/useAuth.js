import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';

export function useAuth() {
  const { handleAuthSuccess, handleLogout, updateUser } = useAuthContext();

  async function signIn(username) {
    const { token, user } = await api.post('/api/auth/signin', { username });
    handleAuthSuccess(token, user);
    return user;
  }

  async function signUpParent(email, password) {
    const { token, user } = await api.post('/api/auth/parent/signup', { email, password });
    handleAuthSuccess(token, user);
    return user;
  }

  async function signInParent(email, password) {
    const { token, user } = await api.post('/api/auth/parent/login', { email, password });
    handleAuthSuccess(token, user);
    return user;
  }

  async function signInWithGoogle(idToken) {
    const { token, user } = await api.post('/api/auth/google', { idToken });
    handleAuthSuccess(token, user);
    return user;
  }

  async function logout() {
    handleLogout();
  }

  async function updateAvatar(avatar) {
    const { user } = await api.put('/api/auth/profile', { avatar });
    updateUser(user);
    return user;
  }

  return { signIn, signUpParent, signInParent, signInWithGoogle, logout, updateAvatar };
}
