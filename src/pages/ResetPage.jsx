import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { homePathFor } from '../utils/homePath';
import { api } from '../api';
import styles from '../styles/ResetPage.module.css';

export function ResetPage() {
  const { user, session, loading } = useAuthContext();
  const [children, setChildren] = useState([]);
  const [childId, setChildId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (user?.account_type !== 'admin') return;
    let cancelled = false;
    api.get('/api/admin/accounts').then(({ children }) => {
      if (!cancelled) setChildren(children);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [user?.account_type]);

  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!session) return <Navigate to="/parent/auth" replace />;
  if (user?.account_type !== 'admin') return <Navigate to={homePathFor(user)} replace />;

  async function reset(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await api.post('/api/admin/reset-progress', { userId: Number(childId) }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.page}><div className={styles.card}>
    <h1 className={styles.title}>Reset child progress</h1>
    {result ? <p>{result.username}'s progress has been reset.</p> : <form onSubmit={reset}>
      <label>Child
        <select className={styles.input} value={childId} onChange={e => setChildId(e.target.value)} required disabled={busy}>
          <option value="">Select a child</option>
          {children.map(child => <option key={child.id} value={child.id}>{child.username}</option>)}
        </select>
      </label>
      <p className={styles.desc}>This permanently clears completed nodes, stars, and practice history for the selected child.</p>
      <button className={styles.dangerBtn} disabled={busy || !childId}>{busy ? 'Resetting...' : 'Reset selected child'}</button>
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Link to="/admin" className={styles.back}>Back to admin</Link>
  </div></div>;
}
