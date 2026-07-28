import { createContext, useContext } from 'react';

// Context object and hook only; <CompanionProvider> lives in
// CompanionProvider.jsx for the Fast Refresh reason described in AuthContext.jsx.
export const CompanionContext = createContext(null);

export function useCompanionContext() {
  return useContext(CompanionContext);
}
