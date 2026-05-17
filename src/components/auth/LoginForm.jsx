import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from '../../styles/AuthPage.module.css';

export function LoginForm({ onSwitch }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.formTitle}>Welcome Back, Dragon Tamer!</h2>
      {error && <p className={styles.error}>{error}</p>}
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
          autoComplete="current-password"
        />
      </label>
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? 'Entering...' : 'Enter the Realm'}
      </button>
      <p className={styles.switchText}>
        New adventurer?{' '}
        <button type="button" className={styles.switchLink} onClick={onSwitch}>
          Create an account
        </button>
      </p>
    </form>
  );
}
