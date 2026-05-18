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
  const [playtime, setPlaytime] = useState(null);

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
    api.get('/api/playtime/me?days=7')
      .then(setPlaytime)
      .catch(() => { /* non-critical; profile still works */ });
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

        {playtime && (
          <div className={styles.playtimeCard}>
            <div className={styles.playtimeToday}>
              <span className={styles.playtimeIcon}>⏱️</span>
              <span className={styles.playtimeBig}>{playtime.today_minutes || 0}</span>
              <span className={styles.playtimeUnit}>min today</span>
            </div>
            <div className={styles.playtimeWeek}>
              {playtime.series.map(d => {
                const max = Math.max(1, ...playtime.series.map(x => x.minutes));
                const pct = (d.minutes / max) * 100;
                return (
                  <div key={d.day} className={styles.playtimeWeekCol} title={`${d.day}: ${d.minutes} min`}>
                    <div className={styles.playtimeWeekTrack}>
                      <div
                        className={styles.playtimeWeekFill}
                        style={{ height: `${Math.max(d.minutes > 0 ? 6 : 0, pct)}%` }}
                      />
                    </div>
                    <div className={styles.playtimeWeekLabel}>{shortDay(d.day)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

function shortDay(iso) {
  const d = new Date(`${iso}T00:00`);
  if (isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1);
}
