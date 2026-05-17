import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { useAuthContext } from '../../contexts/AuthContext';
import { useCompanionContext } from '../../contexts/CompanionContext';
import { COMPANIONS } from '../../data/companions';
import styles from '../../styles/ProfileModal.module.css';

// Order companions appear in the Profile collection. Pip first, then bosses
// in world order (matches the map progression).
const COMPANION_ORDER = ['pip', 'forest_dragon', 'sunfire_dragon', 'crystal_dragon', 'sakura_dragon', 'storm_dragon'];

export function ProfileModal({ onClose }) {
  const { user } = useAuthContext();
  const { updateAvatar } = useAuth();
  const { activeId, setActive, ownsCompanion } = useCompanionContext();
  const [avatars, setAvatars] = useState([]);
  const [selected, setSelected] = useState(user?.avatar || '⚔️');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [companionError, setCompanionError] = useState(null);

  async function handleSelectCompanion(id) {
    if (!ownsCompanion(id) || id === activeId) return;
    try {
      setCompanionError(null);
      await setActive(id);
    } catch (err) {
      setCompanionError(err.message);
    }
  }

  useEffect(() => {
    api.get('/api/auth/avatars')
      .then(({ avatars }) => setAvatars(avatars))
      .catch(err => setError(err.message));
  }, []);

  async function handleSave() {
    if (selected === user?.avatar) return onClose();
    setSaving(true);
    setError(null);
    try {
      await updateAvatar(selected);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>

        <div className={styles.preview}>
          <div className={styles.previewAvatar}>{selected}</div>
          <div className={styles.previewName}>{user?.username}</div>
        </div>

        <h2 className={styles.title}>Choose your avatar</h2>

        <div className={styles.grid}>
          {avatars.map(a => (
            <button
              key={a}
              type="button"
              className={`${styles.avatarBtn} ${a === selected ? styles.avatarBtnSelected : ''}`}
              onClick={() => setSelected(a)}
            >
              {a}
            </button>
          ))}
        </div>

        <h2 className={styles.title}>My Companions</h2>
        <div className={styles.companionGrid}>
          {COMPANION_ORDER.map(id => {
            const c = COMPANIONS[id];
            const isOwned = ownsCompanion(id);
            const isActive = id === activeId;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.companionTile} ${isActive ? styles.companionTileActive : ''} ${!isOwned ? styles.companionTileLocked : ''}`}
                onClick={() => handleSelectCompanion(id)}
                disabled={!isOwned}
                title={isOwned ? c.bondPower.name : `Defeat the boss to befriend ${c.name}`}
              >
                <span className={styles.companionTileIcon}>{isOwned ? c.icon : '?'}</span>
                <span className={styles.companionTileName}>{isOwned ? c.name : '???'}</span>
              </button>
            );
          })}
        </div>
        {companionError && <p className={styles.error}>{companionError}</p>}

        {error && <p className={styles.error}>{error}</p>}

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving || avatars.length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
