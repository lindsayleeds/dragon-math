import { useState } from 'react';
import styles from '../styles/ParentDashboard.module.css';

// Teacher names a brand-new student up front. The account is created ready to go
// (no "waiting to set up" state) with the default avatar the kid can change
// later, and signs in via the same QR/login link as everyone else. `onCreate`
// resolves to an error message string on failure, or null on success.
export function CreateStudentModal({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [realName, setRealName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Type a handle for the student.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onCreate(trimmed, realName.trim());
    if (err) {
      setError(err);
      setBusy(false);
    }
    // On success the parent closes this modal, so no need to reset busy.
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>Create a student</h3>
        <p className={styles.muted}>
          Give the student a handle and we’ll set up their account. You’ll get a QR code to show
          them — they scan it on their tablet to sign in. They can change their avatar later.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Handle (public — shown to classmates)
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. lindsay3"
              maxLength={24}
              autoFocus
              disabled={busy}
            />
          </label>

          <label className={styles.label}>
            Real name (optional — private, grown-ups only)
            <input
              className={styles.input}
              type="text"
              value={realName}
              onChange={e => setRealName(e.target.value)}
              placeholder="e.g. Jordan Lee"
              maxLength={80}
              disabled={busy}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.qrActions}>
            <button className={styles.primaryBtn} type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create student'}
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
