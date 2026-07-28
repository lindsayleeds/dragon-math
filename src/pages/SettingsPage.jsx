import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { FONT_THEMES, DEFAULT_FONT_THEME } from '../data/fontThemes';
import { applyFontTheme } from '../utils/fontTheme';
import styles from '../styles/SettingsPage.module.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { updateFont } = useAuth();
  const savedFont = user?.font || DEFAULT_FONT_THEME;
  // `selected` is the committed choice (set by clicking a card). It's what
  // gets saved and gets the green check. Hovering only previews the font
  // live — it never changes `selected`, so dragging the mouse toward Save
  // can't quietly pick the wrong combo on the way down.
  const [selected, setSelected] = useState(savedFont);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savedRef = useRef(savedFont);
  savedRef.current = savedFont;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Commit a choice: this is the one that saves.
  function choose(id) {
    setSelected(id);
    applyFontTheme(id);
  }

  // Preview a combo live on hover without committing it.
  function previewHover(id) {
    applyFontTheme(id);
  }

  // On mouse leave, snap the live preview back to the committed choice.
  function endHover() {
    applyFontTheme(selectedRef.current);
  }

  useEffect(() => {
    return () => applyFontTheme(savedRef.current);
  }, []);

  async function handleSave() {
    if (selected === savedFont) return navigate('/home');
    setSaving(true);
    setError(null);
    try {
      await updateFont(selected);
      navigate('/home');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.sheet}>
        <button className={styles.backBtn} onClick={() => navigate('/home')} aria-label="Home">
          ⌂ home
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
              onClick={() => choose(theme.id)}
              onMouseEnter={() => previewHover(theme.id)}
              onMouseLeave={endHover}
            >
              {theme.id === selected && (
                <span className={styles.checkBadge} aria-hidden="true">✓</span>
              )}
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
