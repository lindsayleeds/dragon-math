import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../contexts/AuthContext';
import { renderAvatar } from '../utils/avatar';
import styles from '../styles/FamilyLinkPage.module.css';

export function FamilySwitcherModal({ onClose }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { switchFamilyChild } = useAuth();
  const [children, setChildren] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/auth/family-members')
      .then(({ children }) => setChildren(children))
      .catch(err => setError(err.message));
  }, []);

  async function choose(child) {
    if (child.id === user?.id) return onClose();
    setBusyId(child.id);
    setError(null);
    try {
      const nextUser = await switchFamilyChild(child.id);
      onClose();
      navigate(nextUser.needs_handle ? '/welcome' : '/home', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section className={`${styles.card} ${styles.switcherCard}`} onClick={e => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        <h2>Switch adventurer</h2>
        <p className={styles.intro}>Whose turn is it?</p>
        <div className={styles.kidGrid}>
          {children.map(child => (
            <button
              key={child.id}
              type="button"
              className={styles.kidButton}
              onClick={() => choose(child)}
              disabled={busyId !== null}
            >
              <span className={styles.avatar}>{renderAvatar(child.avatar)}</span>
              <span>{child.needs_handle ? 'New traveler' : child.username}</span>
              {child.id === user?.id && <small>playing now</small>}
            </button>
          ))}
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </section>
    </div>
  );
}
