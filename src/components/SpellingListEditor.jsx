import { useMemo, useState } from 'react';
import { api } from '../api';
import { useDialog } from '../hooks/useDialog';
import { useSpellingLists } from '../hooks/useSpellingLists';
import { parseWordList } from '../utils/parseWordList';
import styles from '../styles/SpellingLists.module.css';

// Custom spelling lists — "Week 1", "Week 2", the words that came home from
// school. Shared by the two places a list can be written: the child's own
// Dragon Spelling picker and a parent's dashboard. Pass `childId` when an adult
// is editing on a child's behalf; a child editing their own leaves it null and
// the server scopes to their session.
//
// Saving is deliberately blocking: the server generates ElevenLabs audio for any
// word the site has never spoken before and only then answers, so by the time
// the modal closes the words are ready to play. That takes a few seconds for a
// fresh list, hence the explicit "making audio" state on the save button.

const NAME_MAX = 40;
const WORDS_MAX = 60;

/**
 * Create or edit one list. `list` null = create. `onSaved(list)` fires after the
 * server has stored it (and finished any audio generation).
 */
export function SpellingListEditor({ list, childId, onClose, onSaved }) {
  const [name, setName] = useState(list?.name || '');
  const [text, setText] = useState((list?.words || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Live preview of what the server will keep. It's authoritative on save, but
  // showing the split as they paste beats surprising them afterwards.
  const { words, rejected } = useMemo(() => parseWordList(text), [text]);

  const tooMany = words.length > WORDS_MAX;
  const canSave = !saving && name.trim().length > 0 && words.length > 0 && !tooMany;

  async function handleSave(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), words };
      const data = list
        ? await api.patch(`/api/spelling/lists/${list.id}`, payload)
        : await api.post('/api/spelling/lists', { ...payload, ...(childId ? { child_id: childId } : {}) });
      onSaved?.(data.list, data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={list ? 'Edit word list' : 'New word list'}>
      <form className={styles.modal} onSubmit={handleSave}>
        <h2 className={styles.modalTitle}>{list ? 'Edit word list' : 'New word list'}</h2>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>List name</span>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Week 1"
            maxLength={NAME_MAX}
            autoFocus
            disabled={saving}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Words</span>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste or type the words —\none per line'}
            rows={9}
            disabled={saving}
          />
        </label>

        <div className={styles.preview}>
          <span className={`${styles.count} ${tooMany ? styles.countBad : ''}`}>
            {words.length} word{words.length === 1 ? '' : 's'}
            {tooMany && ` — that's over the ${WORDS_MAX} limit`}
          </span>
          {words.length > 0 && (
            <div className={styles.chips}>
              {words.map((w) => <span key={w} className={styles.chip}>{w}</span>)}
            </div>
          )}
          {rejected.length > 0 && (
            <p className={styles.rejected}>
              Skipping {rejected.map((r) => `“${r}”`).join(', ')} — a spelling word has to be
              a single word of letters only (no spaces, hyphens, or apostrophes), so the
              child can type one clear answer.
            </p>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {saving && (
          <p className={styles.savingNote}>
            Saving and recording the words in the game voice — this takes a few seconds
            the first time a word is used.
          </p>
        )}

        <div className={styles.modalButtons}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={!canSave}>
            {saving ? 'Saving…' : list ? 'Save changes' : 'Create list'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Manage all of one child's lists: view, add, edit, delete. Used by the parent
 * dashboard; the child's own picker shows its lists inline instead.
 */
export function SpellingListManager({ childId, childName, onClose }) {
  const { lists, loading, error, refresh } = useSpellingLists(childId);
  const [editing, setEditing] = useState(null); // list object, or 'new'
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const { confirm, dialog } = useDialog();

  async function handleDelete(list) {
    const ok = await confirm({
      title: `Delete “${list.name}”?`,
      message: 'The list disappears from Dragon Spelling. You can always add it again.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(list.id);
    try {
      await api.delete(`/api/spelling/lists/${list.id}`);
      await refresh();
    } catch (err) {
      setNotice(`Could not delete: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(_list, response) {
    setEditing(null);
    refresh();
    const failed = response?.audio?.failed || 0;
    setNotice(
      failed > 0
        ? `Saved. ${failed} word${failed === 1 ? '' : 's'} couldn't be recorded and will use the device voice instead.`
        : 'Saved — the words are ready to play.',
    );
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Spelling word lists">
      <div className={styles.modal}>
        <h2 className={styles.modalTitle}>Spelling lists{childName ? ` — ${childName}` : ''}</h2>
        <p className={styles.blurb}>
          Add the words {childName || 'your child'} is practicing this week. They show up at the
          top of Dragon Spelling, above the built-in grade lists.
        </p>

        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.error}>{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}

        {!loading && lists.length === 0 && (
          <p className={styles.muted}>No lists yet.</p>
        )}

        <ul className={styles.listRows}>
          {lists.map((l) => (
            <li key={l.id} className={styles.listRow}>
              <div className={styles.listRowMain}>
                <span className={styles.listName}>{l.name}</span>
                <span className={styles.listWords}>
                  {l.words.length} word{l.words.length === 1 ? '' : 's'} · {l.words.slice(0, 6).join(', ')}
                  {l.words.length > 6 ? '…' : ''}
                </span>
                {l.audio_missing?.length > 0 && (
                  <span className={styles.listNote}>
                    {l.audio_missing.length} using the device voice
                  </span>
                )}
              </div>
              <div className={styles.listRowActions}>
                <button className={styles.linkBtn} onClick={() => setEditing(l)} disabled={busyId === l.id}>
                  Edit
                </button>
                <button className={styles.dangerLink} onClick={() => handleDelete(l)} disabled={busyId === l.id}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.modalButtons}>
          <button className={styles.ghostBtn} onClick={onClose}>Close</button>
          <button className={styles.primaryBtn} onClick={() => setEditing('new')}>+ New list</button>
        </div>
      </div>

      {editing && (
        <SpellingListEditor
          list={editing === 'new' ? null : editing}
          childId={childId}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {dialog}
    </div>
  );
}
