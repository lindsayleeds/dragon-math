import { useVersionCheck } from '../hooks/useVersionCheck';

export function UpdateBanner() {
  const { updateAvailable, reload } = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(16px + var(--app-safe-area-bottom))',
        left: 'calc(var(--app-safe-area-left) + (100vw - var(--app-safe-area-left) - var(--app-safe-area-right)) / 2)',
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100vw - 24px - var(--app-safe-area-left) - var(--app-safe-area-right))',
        background: '#222',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
      }}
      role="status"
    >
      <span>A new version of My Dragon Math is available.</span>
      <button
        type="button"
        onClick={reload}
        style={{
          background: '#f5b400',
          color: '#222',
          border: 'none',
          padding: '6px 12px',
          borderRadius: 6,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}
