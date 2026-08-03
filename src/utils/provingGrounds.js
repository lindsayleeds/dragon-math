// Proving Grounds — a timed drill that "proves" a kid's times-tables (and the
// matching division facts) for a single digit 2-9. Every fact in the set is
// asked twice; a bronze/silver/gold medal is awarded on finish time + accuracy.
//
// Set for digit d, multiplication:  1×d, 2×d, … 12×d   (answers d … 12d)
// Set for digit d, division:        d÷d, 2d÷d, … 12d÷d (answers 1 … 12)
// Each of the 12 facts is asked twice → 24 problems per run.

export const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9];

export const MODES = [
  { key: 'mul', label: 'Multiplication', symbol: '×', color: '#d97474', blurb: 'prove your times tables' },
  { key: 'div', label: 'Division',       symbol: '÷', color: '#d4a957', blurb: 'prove your sharing facts' },
];
export const MODE_BY_KEY = Object.fromEntries(MODES.map(m => [m.key, m]));

// Seconds thresholds. Gold/silver require a perfect run; bronze allows one slip.
export const THRESHOLDS = { gold: 45, silver: 60, bronze: 90 };
export const MAX_WRONG_FOR_BRONZE = 1;

export const MEDALS = {
  gold:   { label: 'Gold',   icon: '🥇', color: '#e8b923' },
  silver: { label: 'Silver', icon: '🥈', color: '#aab2bd' },
  bronze: { label: 'Bronze', icon: '🥉', color: '#c08457' },
};
// Ranked worst → best so we only ever overwrite a saved medal with a better one.
const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The 12 facts for a digit, in listed order (1×d … 12×d / d÷d … 12d÷d).
function baseFacts(mode, digit) {
  const facts = [];
  for (let i = 1; i <= 12; i++) {
    if (mode === 'div') {
      const dividend = i * digit;
      facts.push({ a: dividend, b: digit, op: 'div', answer: i, prompt: `${dividend} ÷ ${digit}` });
    } else {
      facts.push({ a: i, b: digit, op: 'mul', answer: i * digit, prompt: `${i} × ${digit}` });
    }
  }
  return facts;
}

// Every fact is asked twice, in a randomized order with no fact repeated
// back-to-back. Two independent shuffles of the 12 facts form the two halves —
// each fact appears once per half, so duplicates can only ever meet at the seam
// between the halves, which we swap away. The result: 24 problems, each fact
// twice, fully mixed, never consecutive.
export function buildProblemSet(mode, digit) {
  const first = shuffle(baseFacts(mode, digit));
  const second = shuffle(baseFacts(mode, digit));
  const seam = first[first.length - 1];
  if (second[0].prompt === seam.prompt) {
    const i = second.findIndex(f => f.prompt !== seam.prompt);
    [second[0], second[i]] = [second[i], second[0]];
  }
  return [...first, ...second];
}

// Which medal (if any) a run earns. Order matters — check strongest first.
export function awardMedal(elapsedSec, wrongCount) {
  if (wrongCount === 0 && elapsedSec <= THRESHOLDS.gold) return 'gold';
  if (wrongCount === 0 && elapsedSec <= THRESHOLDS.silver) return 'silver';
  if (wrongCount <= MAX_WRONG_FOR_BRONZE && elapsedSec <= THRESHOLDS.bronze) return 'bronze';
  return null;
}

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
