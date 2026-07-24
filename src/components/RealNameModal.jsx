import { useState } from 'react';
import styles from '../styles/ParentDashboard.module.css';

// Edit a student's real/legal name — the adult-facing name shown alongside the
// public handle on rosters. Used by the teacher, parent, and school-admin views.
// `onSave(value)` resolves to an error message on failure, or null on success.
// Pass "" to clear. Never shown to other kids.
export function RealNameModal({ handle, current, onSave, onClose }) {
  const [name, setName] = useState(current || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await onSave(name.trim());
    if (err) {
      setError(err);
      setBusy(false);
    }
    // On success the parent closes this modal.
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>Real name</h3>
        <p className={styles.muted}>
          A private name for grown-ups — teachers, school admins, and parents see it next to
          the handle{handle ? <> <strong>{handle}</strong></> : null}. Other kids never see it.
          Leave blank to clear.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Real name
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Jordan Lee"
              maxLength={80}
              autoFocus
              disabled={busy}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.qrActions}>
            <button className={styles.primaryBtn} type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
            <button className={styles.linkBtn} type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
