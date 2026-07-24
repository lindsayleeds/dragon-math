import { Component } from 'react';

// A lazy route chunk can 404 on a client that already had the app open: nginx
// serves /assets/ with `expires 1y; immutable; try_files $uri =404` and
// `vite build` empties outDir, so a deploy removes the hashed chunk this tab
// remembers. Reload once to pick up the fresh build; if the very next load
// fails too, show a way back instead of looping.
const RELOAD_KEY = 'dragonmath.chunkReloadAt';
const RELOAD_WINDOW_MS = 15_000;

function reloadForFreshBuild() {
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
    this.handleRetry = () => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // Nothing to clear — the reload below is what matters.
      }
      window.location.reload();
    };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('A page failed to load', error);
    reloadForFreshBuild();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loading-screen" role="alert">
        <span aria-hidden="true" style={{ fontSize: '2rem' }}>🌿</span>
        <p>This page wandered off to fetch a fresh map.</p>
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
