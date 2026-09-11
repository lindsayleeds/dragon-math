import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useDialog } from '../hooks/useDialog';
import { passageWords, unsupportedMemoryWords } from '../utils/memoryPassage';
import styles from '../styles/SpellingLists.module.css';

const CATEGORIES = [
  ['verse', 'Verse'],
  ['poem', 'Poem'],
  ['quote', 'Quote'],
  ['speech', 'Speech'],
  ['definition', 'Definition'],
  ['other', 'Other'],
];
const MAX_WORDS = 250;

function wordCount(text) {
  return passageWords(text).length;
}

export function MemoryPassageManager({ childId, childName, onClose }) {
  const [passages, setPassages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/memory-passages?child_id=${childId}`)
      .then(data => {
        if (!cancelled) {
          setPassages(data.passages || []);
          setError(null);
        }
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [childId, reload]);

  async function remove(passage) {
    const ok = await confirm({
      title: `Delete “${passage.title}”?`,
      message: 'It disappears from Dragon Memorize. You can always add it again.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(passage.id);
    try {
      await api.delete(`/api/memory-passages/${passage.id}`);
      setReload(value => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Memory passages">
      <div className={styles.modal}>
        <h2 className={styles.modalTitle}>Memory passages{childName ? ` — ${childName}` : ''}</h2>
        <p className={styles.blurb}>
          Add a verse, poem, quotation, speech, or definition. It will appear in Dragon Memorize.
        </p>
        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.error}>{error}</p>}
        {!loading && passages.length === 0 && <p className={styles.muted}>No passages yet.</p>}

        <ul className={styles.listRows}>
          {passages.map(passage => (
            <li key={passage.id} className={styles.listRow}>
              <div className={styles.listRowMain}>
                <span className={styles.listName}>{passage.title}</span>
                <span className={styles.listWords}>
                  {passage.category} · {wordCount(passage.body)} words · {passage.body}
                </span>
              </div>
              <div className={styles.listRowActions}>
                <button className={styles.linkBtn} onClick={() => setEditing(passage)} disabled={busyId === passage.id}>Edit</button>
                <button className={styles.dangerLink} onClick={() => remove(passage)} disabled={busyId === passage.id}>Delete</button>
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.modalButtons}>
          <button className={styles.ghostBtn} onClick={onClose}>Close</button>
          <button className={styles.primaryBtn} onClick={() => setEditing('new')}>+ New passage</button>
        </div>
      </div>

      {editing && (
        <MemoryPassageEditor
          passage={editing === 'new' ? null : editing}
          childId={childId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setReload(value => value + 1); }}
        />
      )}
      {dialog}
    </div>
  );
}

function MemoryPassageEditor({ passage, childId, onClose, onSaved }) {
  const [title, setTitle] = useState(passage?.title || '');
  const [category, setCategory] = useState(passage?.category || 'verse');
  const [body, setBody] = useState(passage?.body || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const count = useMemo(() => wordCount(body), [body]);
  const unsupported = useMemo(() => unsupportedMemoryWords(body), [body]);
  const canSave = !saving && title.trim() && count > 0 && count <= MAX_WORDS && unsupported.length === 0;

  async function save(event) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { title: title.trim(), category, body: body.trim() };
      if (passage) await api.patch(`/api/memory-passages/${passage.id}`, payload);
      else await api.post('/api/memory-passages', { ...payload, child_id: childId });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={passage ? 'Edit memory passage' : 'New memory passage'}>
      <form className={styles.modal} onSubmit={save}>
        <h2 className={styles.modalTitle}>{passage ? 'Edit passage' : 'New passage'}</h2>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title or reference</span>
          <input className={styles.input} value={title} onChange={event => setTitle(event.target.value)} placeholder="Psalm 23:1" maxLength={100} autoFocus disabled={saving} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Kind of passage</span>
          <select className={styles.input} value={category} onChange={event => setCategory(event.target.value)} disabled={saving}>
            {CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Words to memorize</span>
          <textarea className={styles.textarea} value={body} onChange={event => setBody(event.target.value)} placeholder="Paste one or several sentences here." rows={8} disabled={saving} />
        </label>
        <div className={styles.preview}>
          <span className={`${styles.count} ${count > MAX_WORDS ? styles.countBad : ''}`}>{count} / {MAX_WORDS} words</span>
        </div>
        {unsupported.length > 0 && (
          <p className={styles.error}>Each word must begin with A–Z or 0–9 so Hard mode can be played. Change: {unsupported.slice(0, 3).join(', ')}.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.modalButtons}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={styles.primaryBtn} disabled={!canSave}>{saving ? 'Saving…' : 'Save passage'}</button>
        </div>
      </form>
    </div>
  );
}
