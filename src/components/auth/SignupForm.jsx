import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from '../../styles/AuthPage.module.css';

export function SignupForm({ onSwitch }) {
  const { signup } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup(email, password, displayName);
      // AuthContext sets user → App.jsx redirects to /map automatically
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.formTitle}>Begin Your Adventure!</h2>
      {error && <p className={styles.error}>{error}</p>}
      <label className={styles.label}>
        Your Name
        <input
          className={styles.input}
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Dragon Tamer"
          required
          autoComplete="name"
        />
      </label>
      <label className={styles.label}>
        Email
        <input
          className={styles.input}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className={styles.label}>
        Password
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
      </label>
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Start Adventure'}
      </button>
      <p className={styles.switchText}>
        Already have an account?{' '}
        <button type="button" className={styles.switchLink} onClick={onSwitch}>
          Log in
        </button>
      </p>
    </form>
  );
}
