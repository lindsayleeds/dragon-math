import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

// The GET /api/rule-settings document (server/lib/ruleSettings.js), fetched
// once per page load and shared by every game that reads a tunable from it.
// (The battle loads its own copy in useBattle, which also re-deals the grid.)
//
// Games never wait for it: each one reads a section through its converter in
// src/data/ruleSettings.js, which falls back field by field to the same values
// the server serves, so a game started before the fetch lands — or offline —
// plays by identical rules. main.jsx starts the fetch at boot so it has
// usually arrived by the time a game mounts.

let cachedDoc = null;
let pending = null;

// Start (or join) the fetch. Resolves to the document, or null on failure — a
// failed fetch is forgotten, so the next caller retries.
export function loadRuleSettings() {
  if (cachedDoc) return Promise.resolve(cachedDoc);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => api.get('/api/rule-settings'))
      .then((doc) => {
        cachedDoc = doc && typeof doc === 'object' ? doc : null;
        pending = null;
        return cachedDoc;
      })
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

// The document if it has already arrived, else null. For rules that fix their
// settings when a game is dealt (Munchers, the trial, Stepping Stones).
export function cachedRuleSettings() {
  return cachedDoc;
}

// One section, converted: `fromServer(doc)` from src/data/ruleSettings.js. It
// returns the fallbacks at first and the served values once they load. The
// result keeps its identity while its values don't change, so served values
// equal to the fallbacks re-run no memo or effect downstream (a Memorize tile
// bank would otherwise reshuffle when the document lands).
export function useRuleSettings(fromServer) {
  const [doc, setDoc] = useState(cachedDoc);
  useEffect(() => {
    if (doc) return undefined;
    let live = true;
    loadRuleSettings().then((loaded) => {
      if (live && loaded) setDoc(loaded);
    });
    return () => { live = false; };
  }, [doc]);
  const settings = fromServer(doc);
  const key = JSON.stringify(settings);
  // Keyed on the values, not the object: `settings` is new every render.
  return useMemo(() => settings, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Tests only: forget the cached document.
export function resetRuleSettingsCache() {
  cachedDoc = null;
  pending = null;
}
