import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';

export function useAuth() {
  const { handleAuthSuccess, handleLogout, updateUser } = useAuthContext();

  async function signIn(username) {
    const { token, user } = await api.post('/api/auth/signin', { username });
    handleAuthSuccess(token, user);
    return user;
  }

  // Passwordless kid sign-in via the GUID in their /k/<token> login URL.
  async function loginWithToken(loginToken) {
    const { token, user } = await api.post('/api/auth/child-login', { token: loginToken });
    handleAuthSuccess(token, user);
    return user;
  }

  // First-time kid: pick a handle (and optionally an avatar). Returns a fresh
  // token because the username embedded in the JWT just changed.
  async function createHandle(username, avatar) {
    const { token, user } = await api.post('/api/auth/child/handle', { username, avatar });
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

  return { signIn, loginWithToken, createHandle, signUpParent, signInParent, signInWithGoogle, logout, updateAvatar };
}
