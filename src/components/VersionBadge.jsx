const BUILD = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;

// Short "when was this bundle built" string. builtAt is the field that actually
// changes on every `vite build` — the git commit stays put while work is
// uncommitted, so builtAt is what tells two builds apart.
function shortBuilt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// A tiny, unobtrusive build stamp pinned to the bottom-right corner so you can
// glance at any screen (including inside the home-screen PWA, which has no
// reload button) and confirm which build is actually loaded. pointer-events is
// off so it never intercepts a tap on the UI beneath it.
export function VersionBadge() {
  if (!BUILD) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        right: 'calc(6px + env(safe-area-inset-right))',
        bottom: 'calc(6px + env(safe-area-inset-bottom))',
        zIndex: 9999,
        pointerEvents: 'none',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 10,
        lineHeight: 1,
        letterSpacing: '0.02em',
        color: 'rgba(61, 53, 40, 0.55)',
        background: 'rgba(255, 255, 255, 0.6)',
        border: '1px solid rgba(61, 53, 40, 0.12)',
        borderRadius: 6,
        padding: '3px 6px',
      }}
    >
      {BUILD.commitShort} · {shortBuilt(BUILD.builtAt)}
    </div>
  );
}
