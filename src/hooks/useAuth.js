import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';
import { applyFontTheme } from '../utils/fontTheme';

export function useAuth() {
  const { handleAuthSuccess, enterGuest, handleLogout, updateUser } = useAuthContext();

  // Ephemeral guest play — no account, nothing saved. Caller handles navigation.
  function playAsGuest() {
    enterGuest();
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

  async function signUpParent(email, password, role = 'parent', compToken = null) {
    const body = { email, password, role };
    if (compToken) body.compToken = compToken;
    const { token, user } = await api.post('/api/auth/parent/signup', body);
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

  // ---- Password reset (public) ----

  // Request a reset link. Always resolves (server returns a uniform message
  // whether or not the email has an account) — the UI shows "check your email".
  async function forgotPassword(email) {
    return api.post('/api/auth/password/forgot', { email });
  }

  // Redeem a reset token and set a new password; signs the user in on success.
  async function resetPassword(token, password) {
    const { token: jwt, user } = await api.post('/api/auth/password/reset', { token, password });
    handleAuthSuccess(jwt, user);
    return user;
  }

  // ---- Email verification ----

  async function verifyEmail(token) {
    return api.post('/api/auth/email/verify', { token });
  }

  async function resendVerify() {
    return api.post('/api/auth/email/resend');
  }

  // ---- Account management (signed-in parent) ----

  async function changePassword(currentPassword, newPassword) {
    return api.post('/api/auth/password/change', { currentPassword, newPassword });
  }

  // Change email → server re-issues the JWT (username is the email) and returns
  // the updated user (email_verified now false). Refresh the whole session.
  async function changeEmail(newEmail, currentPassword) {
    const { token, user } = await api.post('/api/auth/email/change', { newEmail, currentPassword });
    handleAuthSuccess(token, user);
    return user;
  }

  async function deleteAccount(currentPassword) {
    await api.delete('/api/auth/account', { currentPassword });
    handleLogout();
  }

  async function updateAvatar(avatar) {
    const { user } = await api.put('/api/auth/profile', { avatar });
    updateUser(user);
    return user;
  }

  async function updateFont(font) {
    const { user } = await api.put('/api/auth/profile', { font });
    updateUser(user);
    applyFontTheme(font);
    return user;
  }

  return {
    playAsGuest, loginWithToken, createHandle, signUpParent, signInParent, signInWithGoogle, logout,
    updateAvatar, updateFont,
    forgotPassword, resetPassword, verifyEmail, resendVerify, changePassword, changeEmail, deleteAccount,
  };
}
