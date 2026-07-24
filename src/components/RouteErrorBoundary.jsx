import { Component } from 'react';

// A lazy route chunk can 404 on a client that already had the app open: nginx
// serves /assets/ with `expires 1y; immutable; try_files $uri =404` and
// `vite build` empties outDir, so a deploy removes the hashed chunk this tab
// remembers. Reload once to pick up the fresh build; if the very next load
// fails too, show a way back instead of looping.
const RELOAD_KEY = 'dragonmath.chunkReloadAt';
const RELOAD_WINDOW_MS = 15_000;

// Chrome says "Failed to fetch dynamically imported module", Firefox "error
// loading dynamically imported module", Safari "Importing a module script
// failed". "Unable to preload CSS" is Vite's own: __vitePreload injects a
// <link> for each of a chunk's CSS deps and rejects on that link's error event
// before it ever reaches the import(). Every lazy route here ships a CSS
// module, so post-deploy the stylesheet 404 usually rejects first — keep it in
// this list even though it names no module. Anything unrecognised counts as a
// normal crash, not a missing chunk.
const CHUNK_ERROR_RE = new RegExp(
  [
    'failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'importing a module script failed',
    'loading chunk \\S+ failed',
    'unable to preload css',
  ].join('|'),
  'i',
);

function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const message = typeof error === 'string' ? error : error.message;
  return typeof message === 'string' && CHUNK_ERROR_RE.test(message);
}

function reloadForFreshBuild() {
  // index.html is served no-cache with no service worker, so a reload while the
  // network is down would swap the working app for the browser's offline page.
  // navigator.onLine is only a hint (it reads true on a captive network), so the
  // sessionStorage window below stays the real backstop.
  if (navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last && Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Private-mode storage can throw — fall back to the manual retry rather
    // than risk a reload loop.
    return false;
  }
  window.location.reload();
  return true;
}

export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
    this.handleRetry = () => window.location.reload();
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('Route render failed', error, info?.componentStack);
    // Only a missing chunk is fixed by fetching the new build. A render crash
    // reloads into the same crash, so show the fallback and keep the error in
    // the console where it stays diagnosable.
    if (isChunkLoadError(error)) reloadForFreshBuild();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loading-screen" role="alert">
        <span aria-hidden="true" style={{ fontSize: '2rem' }}>🌿</span>
        <p>This page needs a moment to find its way back.</p>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            background: '#f5b400',
            color: '#222',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Tap to try again
        </button>
      </div>
    );
  }
}
