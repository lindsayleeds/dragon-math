import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const BUILD = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AboutPage() {
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setLatest)
      .catch(err => setError(err.message));
  }, []);

  const stale = latest && BUILD && latest.commit && BUILD.commit && latest.commit !== BUILD.commit;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>About My Dragon Math</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        <Link to="/map">← Back to map</Link>
      </p>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Running build (this tab)</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
          <dt style={{ color: '#666' }}>Commit</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>
            {BUILD?.commitShort || '—'}{' '}
            <span style={{ color: '#999', fontSize: 12 }}>({BUILD?.commit || 'unknown'})</span>
          </dd>
          <dt style={{ color: '#666' }}>Commit date</dt>
          <dd style={{ margin: 0 }}>{formatDate(BUILD?.commitDate)}</dd>
          <dt style={{ color: '#666' }}>Built at</dt>
          <dd style={{ margin: 0 }}>{formatDate(BUILD?.builtAt)}</dd>
        </dl>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Latest deployed build (server)</h2>
        {error && <p style={{ color: '#b00' }}>Could not load /version.json: {error}</p>}
        {!error && !latest && <p style={{ color: '#666' }}>Checking…</p>}
        {latest && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
            <dt style={{ color: '#666' }}>Commit</dt>
            <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>
              {latest.commitShort || '—'}{' '}
              <span style={{ color: '#999', fontSize: 12 }}>({latest.commit})</span>
            </dd>
            <dt style={{ color: '#666' }}>Commit date</dt>
            <dd style={{ margin: 0 }}>{formatDate(latest.commitDate)}</dd>
            <dt style={{ color: '#666' }}>Built at</dt>
            <dd style={{ margin: 0 }}>{formatDate(latest.builtAt)}</dd>
          </dl>
        )}
        {stale && (
          <p style={{ marginTop: 16, padding: 12, background: '#fff4d6', borderRadius: 6 }}>
            A newer version is available.{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ border: 'none', background: '#f5b400', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            >
              Reload now
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
