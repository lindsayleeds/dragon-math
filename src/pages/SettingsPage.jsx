import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { FONT_THEMES, DEFAULT_FONT_THEME, getFontTheme } from '../data/fontThemes';
import { applyFontTheme } from '../utils/fontTheme';
import styles from '../styles/SettingsPage.module.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { updateFont } = useAuth();
  const savedFont = user?.font || DEFAULT_FONT_THEME;
  const [selected, setSelected] = useState(savedFont);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savedRef = useRef(savedFont);
  savedRef.current = savedFont;

  // Preview the focused combo live. If the player leaves without saving, snap
  // back to whatever is actually persisted so the preview never sticks.
  function preview(id) {
    setSelected(id);
    applyFontTheme(id);
  }

  useEffect(() => {
    return () => applyFontTheme(savedRef.current);
  }, []);

  async function handleSave() {
    if (selected === savedFont) return navigate('/map');
    setSaving(true);
    setError(null);
    try {
      await updateFont(selected);
      navigate('/map');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.sheet}>
        <button className={styles.backBtn} onClick={() => navigate('/map')} aria-label="Back to map">
          ← back
        </button>

        <h1 className={styles.title}>Settings</h1>
        <h2 className={styles.sectionTitle}>Pick your fonts</h2>
        <p className={styles.hint}>Choose a font combo for your whole adventure.</p>

        <div className={styles.grid}>
          {FONT_THEMES.map(theme => (
            <button
              key={theme.id}
              type="button"
              className={`${styles.card} ${theme.id === selected ? styles.cardSelected : ''}`}
              style={{ '--preview-display': theme.display, '--preview-body': theme.body }}
              onClick={() => preview(theme.id)}
              onMouseEnter={() => preview(theme.id)}
            >
              <span className={styles.cardLabel}>{theme.label}</span>
              <span className={styles.previewDisplay}>Dragon Math</span>
              <span className={styles.previewBody}>Add, hatch &amp; explore!</span>
            </button>
          ))}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
