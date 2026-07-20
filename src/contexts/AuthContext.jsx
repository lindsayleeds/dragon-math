import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, setGuestMode } from '../api';
import { setGuestTestMode, TEST_UNLOCK_NODE_ID } from '../data/guestStubs';
import { applyFontTheme } from '../utils/fontTheme';
import { restoreKidManifest, rememberKidLinkToken, forgetKidLinkToken } from '../utils/kidManifest';

const AuthContext = createContext(null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If a kid logged in via their /k/<token> link before, keep the home-screen
    // manifest pointed at that link across reloads.
    restoreKidManifest();

    // iOS "Add to Home Screen" bakes the *current page URL* into the shortcut
    // (it ignores the manifest start_url), and a standalone web app has its own
    // storage with no saved login. So kid links carry their token on as ?k=<token>
    // (see KidLinkPage); recover the session from it here, before any route guard
    // runs, so a home-screen launch logs straight in instead of hitting /auth.
    let cancelled = false;
    const kidToken = new URLSearchParams(window.location.search).get('k');

    async function init() {
      const jwt = localStorage.getItem('dm_token');
      if (jwt) {
        try {
          const { user } = await api.get('/api/auth/me');
          if (!cancelled) setUser(user);
          return;
        } catch {
          setToken(null); // stale/invalid token — fall through to ?k recovery
        }
      }
      if (kidToken && UUID_RE.test(kidToken)) {
        try {
          const { token, user } = await api.post('/api/auth/child-login', { token: kidToken });
          if (cancelled) return;
          setGuestMode(false);
          setToken(token);
          setUser(user);
          rememberKidLinkToken(kidToken);
        } catch {
          /* link expired or revoked — the route guard sends them to /auth */
        }
      }
    }

    init().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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

  // "Test the games": a teacher/parent drops into a fully-unlocked sandbox that
  // plays exactly like a kid's session but persists nothing. Their real JWT stays
  // in localStorage, so exitTestMode restores the grown-up via /api/auth/me.
  //
  // `effective_plan: 'premium'` gives the sandbox full preview access: the whole
  // point of "test the games" is to let a grown-up try every game (including
  // paid-only ones like Dragon Munchers) before deciding to subscribe. Nothing
  // persists, so this grants no real entitlement — it only unlocks the preview.
  function enterTestMode() {
    setGuestTestMode(true);
    setGuestMode(true);
    setUser({
      account_type: 'guest',
      username: 'Test Player',
      current_node_id: TEST_UNLOCK_NODE_ID,
      avatar: '⚔️',
      font: 'handwritten',
      is_guest: true,
      is_test: true,
      effective_plan: 'premium',
    });
  }

  // Leave the sandbox and restore the grown-up session from their stored token.
  // Returns the restored user so the caller can route back to the right dashboard.
  async function exitTestMode() {
    setGuestTestMode(false);
    setGuestMode(false);
    try {
      const { user } = await api.get('/api/auth/me');
      setUser(user);
      return user;
    } catch {
      // Token went stale while testing — fall back to a clean signed-out state.
      setToken(null);
      setUser(null);
      return null;
    }
  }

  function handleLogout() {
    setGuestTestMode(false);
    setGuestMode(false);
    setToken(null);
    setUser(null);
    forgetKidLinkToken();
  }

  function updateUser(userData) {
    setUser(prev => ({ ...prev, ...userData }));
  }

  const session = user ? { user } : null;
  const isGuest = user?.account_type === 'guest';
  const isTesting = user?.is_test === true;

  return (
    <AuthContext.Provider value={{ session, user, loading, isGuest, isTesting, handleAuthSuccess, enterGuest, enterTestMode, exitTestMode, handleLogout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
