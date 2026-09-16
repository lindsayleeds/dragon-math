// A Google credential that was obtained but not yet exchanged for a session.
//
// Why this exists: on iPad, Safari reliably tears the page down at the moment
// Google Identity Services hands back a credential — returning from Google's
// sign-in UI fires focus + visibilitychange and the backgrounded tab gets
// reloaded from scratch. The in-flight `POST /api/auth/google` dies with it
// (nginx logged these as 499 with a zero-byte response, on every iPad attempt
// across two iPadOS versions, while every other platform got a 200), so the
// parent saw the Google button "do nothing" and no account was ever created.
//
// The credential is therefore parked here *before* the request goes out, so the
// page that comes back from the reload can finish the exchange instead of
// silently dropping it.
//
// On storing a bearer token: this is a short-lived Google ID token in
// sessionStorage, which is same-origin and scoped to the one tab. It is erased
// as soon as the exchange settles, and the app already keeps its own much
// longer-lived JWT in localStorage (`dm_token` in src/api.js) — so this widens
// nothing, and the TTL and attempt cap below keep the window small.

const KEY = 'dragonmath.pendingGoogleCredential';

// Google ID tokens stay valid for about an hour, but a credential worth
// resuming is seconds old. A short TTL means a tab reopened much later fails
// closed (back to the button) rather than replaying a stale token.
const TTL_MS = 5 * 60_000;

// A reload that keeps happening must not retry forever. Three attempts covers
// the observed failure (one reload per tap) and then gives up.
const MAX_ATTEMPTS = 3;

export function savePendingCredential(credential) {
  if (!credential) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ credential, at: Date.now(), attempts: 0 }));
  } catch {
    // Private-mode storage can throw. Losing the resume path just means the
    // sign-in fails the way it already did — never block the exchange itself.
  }
}

export function clearPendingCredential() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do — see above.
  }
}

// Returns a credential still worth resuming and counts the attempt, or null.
// The entry deliberately stays in storage: the caller clears it once the
// exchange settles, so a reload *during* the retry can still pick it up.
export function takePendingCredential() {
  let entry;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    entry = JSON.parse(raw);
  } catch {
    clearPendingCredential();
    return null;
  }

  const fresh = entry
    && typeof entry.credential === 'string'
    && entry.credential
    && typeof entry.at === 'number'
    && Date.now() - entry.at < TTL_MS;
  const attempts = Number(entry?.attempts) || 0;
  if (!fresh || attempts >= MAX_ATTEMPTS) {
    clearPendingCredential();
    return null;
  }

  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...entry, attempts: attempts + 1 }));
  } catch {
    // Can't count the attempt — clear rather than risk an unbounded retry.
    clearPendingCredential();
    return null;
  }
  return entry.credential;
}
