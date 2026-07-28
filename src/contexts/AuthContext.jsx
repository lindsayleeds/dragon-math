import { createContext, useContext } from 'react';

// The context object and its hook, deliberately kept apart from <AuthProvider>
// (which lives in AuthProvider.jsx). Fast Refresh only preserves state for a
// module whose exports are ALL components, and 24 files import useAuthContext
// from here — so the provider moved out rather than this, which keeps those
// import paths untouched.
export const AuthContext = createContext(null);

export function useAuthContext() {
  return useContext(AuthContext);
}
