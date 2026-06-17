// Kid "login by URL" home-screen support.
//
// PWA shortcuts launch at the manifest's start_url, NOT the page you were on
// when you tapped "Add to Home Screen". With the default start_url ("/") a
// kid's home-screen icon lands on /auth, because the standalone app has its own
// storage and never sees the browser's saved login. So while a kid is signed in
// via their /k/<token> link, we point the manifest at a per-kid endpoint whose
// start_url IS /k/<token> — every launch re-exchanges the token for a fresh
// session and drops them on the map. (A real same-origin URL is used rather
// than a blob:/data: manifest, which iOS Safari does not reliably honor.)

const STORAGE_KEY = 'dm_kid_link_token';
const DEFAULT_MANIFEST = '/manifest.webmanifest';

function setManifestHref(href) {
  const link = document.querySelector('link[rel="manifest"]');
  if (link) link.setAttribute('href', href);
}

function kidManifestHref(token) {
  return `/api/manifest/k/${encodeURIComponent(token)}`;
}

// Point the home-screen manifest at this kid's login link and remember it so
// the override survives reloads and in-app navigation for the session.
export function rememberKidLinkToken(token) {
  if (!token) return;
  try { localStorage.setItem(STORAGE_KEY, token); } catch { /* private mode */ }
  setManifestHref(kidManifestHref(token));
}

// Re-apply the override on a fresh page load if we logged in via a link earlier.
// No-ops when there is no remembered token.
export function restoreKidManifest() {
  let token = null;
  try { token = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
  if (token) setManifestHref(kidManifestHref(token));
}

// Back to the generic app manifest (e.g. on logout).
export function forgetKidLinkToken() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  setManifestHref(DEFAULT_MANIFEST);
}
