import { useEffect, useState } from 'react';
import { api } from '../api';
import { useDialog } from '../hooks/useDialog';
import styles from '../styles/ParentDashboard.module.css';

// The parent dashboard's API-keys card: mint a key, see the ones you have,
// delete one.
//
// The whole reason this screen is careful is the create flow. The server hashes
// the token and returns the plaintext exactly once, so `newToken` below is the
// only copy that will ever exist — if this component drops it before the person
// copies it, the key is unusable and has to be replaced. Hence: it is held in
// state, shown in a panel that does not close on its own, and labelled as
// one-time rather than quietly rendered next to the others.

const AGENT_INSTRUCTIONS_PATH = '/agent-api/instructions.txt';

// Reads as the tail of "Last used …".
function formatWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ApiKeyManager() {
  const { alert, confirm, dialog } = useDialog();
  const [keys, setKeys] = useState([]);
  const [max, setMax] = useState(null);
  const [loading, setLoading] = useState(true);
  // Distinct from "loaded and empty": if the fetch failed, saying "no API keys
  // yet" would tell someone their keys had vanished.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  // The one-time plaintext, or null. Cleared only by an explicit dismiss.
  const [newToken, setNewToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [instructionsCopied, setInstructionsCopied] = useState(false);

  const instructionsUrl = new URL(AGENT_INSTRUCTIONS_PATH, window.location.origin).href;

  // Same shape as MemoryPassageManager's loader: the `cancelled` flag keeps a
  // late response from writing to an unmounted component, and the state writes
  // live in promise callbacks rather than the effect body.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/api-keys')
      .then(data => {
        if (cancelled) return;
        setKeys(data.keys || []);
        setMax(data.max ?? null);
        setLoaded(true);
        setError('');
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load your API keys.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const atCap = max != null && keys.length >= max;

  async function handleCreate(e) {
    e.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      const data = await api.post('/api/api-keys', { name });
      // Order matters: hold the token before anything that could throw.
      setNewToken(data.token);
      setCopied(false);
      setName('');
      setKeys(prev => [...prev, data.key]);
      setError('');
    } catch (e2) {
      setError(e2.message || 'Could not create that key.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (permissions, http, an old browser).
      // The token is on screen and selectable either way, so this is a nudge,
      // not a failure.
      setCopied(false);
      alert({ title: 'Copy it by hand', message: 'Your browser blocked the clipboard — select the key above and copy it.' });
    }
  }

  async function handleCopyInstructionsUrl() {
    try {
      await navigator.clipboard.writeText(instructionsUrl);
      setInstructionsCopied(true);
    } catch {
      setInstructionsCopied(false);
      alert({
        title: 'Copy the link by hand',
        message: `Your browser blocked the clipboard. Copy this instructions link: ${instructionsUrl}`,
      });
    }
  }

  async function handleDelete(key) {
    const ok = await confirm({
      title: `Delete “${key.name}”?`,
      message: 'Any script still using this key will stop working right away. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/api-keys/${key.id}`);
      setKeys(prev => prev.filter(k => k.id !== key.id));
    } catch (e) {
      setError(e.message || 'Could not delete that key.');
    }
  }

  return (
    <section className={styles.section}>
      {dialog}
      <div className={styles.sectionHead}>
        <div>
          <h2>API keys</h2>
          <p className={styles.muted}>
            Give an API key to an AI agent so it can manage spelling lists and memory passages
            for you. The key acts as you and reaches only your own children.
          </p>
        </div>
      </div>

      <div className={styles.apiKeyAgentGuide}>
        <div>
          <strong>Using an agent?</strong>
          <p className={styles.muted}>
            Give the agent your key and this instructions link. It can fetch the guide and learn
            what it is allowed to change and how to use the key safely.
          </p>
        </div>
        <div className={styles.apiKeyGuideActions}>
          <a
            className={styles.primaryBtn}
            href={AGENT_INSTRUCTIONS_PATH}
            target="_blank"
            rel="noreferrer"
          >
            View agent instructions
          </a>
          <button type="button" className={styles.linkBtn} onClick={handleCopyInstructionsUrl}>
            {instructionsCopied ? 'Instructions URL copied' : 'Copy instructions URL'}
          </button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {newToken && (
        <div className={styles.apiKeyReveal}>
          <p className={styles.apiKeyRevealLead}>
            Copy this now — it is shown once and cannot be recovered.
          </p>
          <code className={styles.apiKeyToken}>{newToken}</code>
          <div className={styles.apiKeyRevealActions}>
            <button type="button" className={styles.primaryBtn} onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => setNewToken(null)}>
              I have saved it
            </button>
          </div>
        </div>
      )}

      <form className={styles.apiKeyForm} onSubmit={handleCreate}>
        <label className={styles.label} htmlFor="api-key-name">New key name</label>
        <div className={styles.apiKeyFormRow}>
          <input
            id="api-key-name"
            className={styles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Weekly spelling import"
            maxLength={60}
            disabled={atCap}
          />
          <button type="submit" className={styles.primaryBtn} disabled={saving || atCap || !name.trim()}>
            {saving ? 'Creating…' : 'Create key'}
          </button>
        </div>
        {atCap && (
          <p className={styles.muted}>That&rsquo;s {max} keys — delete one to make another.</p>
        )}
      </form>

      {loading ? (
        <p className={styles.muted}>Loading…</p>
      ) : !loaded ? null : keys.length === 0 ? (
        <p className={styles.muted}>No API keys yet.</p>
      ) : (
        <ul className={styles.apiKeyList}>
          {keys.map(key => (
            <li key={key.id} className={styles.apiKeyRow}>
              <div className={styles.apiKeyIdentity}>
                <span className={styles.apiKeyName}>{key.name}</span>
                <code className={styles.apiKeyPrefix}>{key.prefix}…</code>
              </div>
              <span className={styles.muted}>Last used {formatWhen(key.last_used_at)}</span>
              <button type="button" className={styles.dangerLink} onClick={() => handleDelete(key)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
