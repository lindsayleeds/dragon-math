// Proving Grounds — the per-kid best-medal storage for the timed × and ÷
// drills. The drill rules themselves (problem sets, medal thresholds, the run
// timer) are pure and live in src/rules/provingGrounds.js, so the Swift port can
// be checked against golden output; they're re-exported here so existing
// imports keep working.

import { MEDAL_RANK } from '../rules/provingGrounds';

export {
  DIGITS,
  MODES,
  MODE_BY_KEY,
  THRESHOLDS,
  MAX_WRONG_FOR_BRONZE,
  MEDALS,
  MEDAL_RANK,
  buildProblemSet,
  awardMedal,
  elapsedSeconds,
  createDrillTimer,
} from '../rules/provingGrounds';

// ---- best-medal persistence (localStorage, per kid) --------------------------
//
// localStorage is the fast/offline copy, not the record of truth: the server
// holds one timestamped row per medal (that's what a grown-up sees). This map
// is a best-per-level rollup so the level grid can paint before any fetch, and
// so a kid mid-run without a network still sees their medals.
const storageKey = (userId) => `dm_proving_grounds_${userId ?? 'guest'}`;
const levelKey = (mode, digit) => `${mode}-${digit}`;

export function loadMedals(userId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId))) || {};
  } catch {
    return {};
  }
}

export function bestMedal(medals, mode, digit) {
  return medals?.[levelKey(mode, digit)] || null;
}

// Save `medal` for this level if it beats what's stored. Returns the (possibly
// updated) medals map and whether this run set a new personal best.
export function recordMedal(userId, mode, digit, medal) {
  const medals = loadMedals(userId);
  if (!medal) return { medals, isBest: false };
  const key = levelKey(mode, digit);
  const isBest = MEDAL_RANK[medal] > MEDAL_RANK[medals[key] || 'none'];
  if (isBest) {
    medals[key] = medal;
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(medals));
    } catch {
      /* storage full / disabled — medals just won't persist */
    }
  }
  return { medals, isBest };
}

// Fold the server's best-per-level map into this device's, keeping whichever
// medal is better for each level, and persist the result. Neither side wins
// outright: the server may hold a gold earned on the school iPad, while this
// device may hold one earned offline that hasn't been posted yet.
export function mergeMedals(userId, serverMedals) {
  const local = loadMedals(userId);
  const merged = { ...local };
  for (const [key, medal] of Object.entries(serverMedals || {})) {
    if (!MEDAL_RANK[medal]) continue; // ignore anything we don't recognise
    if (MEDAL_RANK[medal] > MEDAL_RANK[merged[key] || 'none']) merged[key] = medal;
  }
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(merged));
  } catch {
    /* storage full / disabled — the merged map still drives this session */
  }
  return merged;
}
