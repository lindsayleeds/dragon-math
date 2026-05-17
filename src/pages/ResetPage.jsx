import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/ResetPage.module.css';

const BASE_URL = 'http://localhost:3001';

async function postReset(adminPassword) {
  const token = localStorage.getItem('dm_token');
  const res = await fetch(`${BASE_URL}/api/admin/reset-progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': adminPassword,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function ResetPage() {
  const { user, updateUser } = useAuthContext();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [authedPassword, setAuthedPassword] = useState(null);
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetResult, setResetResult] = useState(null);

  async function handleUnlock(e) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError('');
    try {
      await fetch('http://localhost:3001/api/admin/check', {
        headers: { 'x-admin-password': password },
      }).then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `Request failed (${r.status})`);
        }
      });
      setAuthedPassword(password);
    } catch (err) {
      setUnlockError(err.message);
    } finally {
      setUnlocking(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setResetError('');
    try {
      const data = await postReset(authedPassword);
      updateUser({ current_node_id: 1 });
      setResetResult(data);
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (!authedPassword) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.icon}>🔒</div>
          <h1 className={styles.title}>Reset progress</h1>
          <p className={styles.desc}>Enter the admin password to continue.</p>
          <form onSubmit={handleUnlock}>
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
              autoFocus
            />
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={unlocking || !password}
            >
              {unlocking ? 'Checking…' : 'Unlock'}
            </button>
            {unlockError && <p className={styles.error}>{unlockError}</p>}
          </form>
          <Link to="/map" className={styles.back}>← Back to map</Link>
        </div>
      </div>
    );
  }

  if (resetResult) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.icon}>✨</div>
          <h1 className={styles.title}>All done!</h1>
          <p className={styles.desc}>
            {resetResult.username}'s progress has been reset. Time for a fresh adventure.
          </p>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => navigate('/map')}
          >
            Back to map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.icon}>⚠️</div>
        <h1 className={styles.title}>Reset {user?.username}'s progress?</h1>
        <p className={styles.desc}>
          This will clear all completed nodes, stars, and practice history.
          Your account, username, and avatar will stay the same.
        </p>
        <button
          type="button"
          className={styles.dangerBtn}
          onClick={handleReset}
          disabled={resetting}
        >
          {resetting ? 'Resetting…' : 'Yes, reset my progress'}
        </button>
        {resetError && <p className={styles.error}>{resetError}</p>}
        <Link to="/map" className={styles.back}>Cancel</Link>
      </div>
    </div>
  );
}
