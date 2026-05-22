import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from '../../styles/AuthPage.module.css';

export function SignInForm() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(username.trim());
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.formTitle}>Welcome, Dragon Tamer!</h2>
      {error && <p className={styles.error}>{error}</p>}
      <label className={styles.label}>
        Your traveler name
        <input
          className={styles.input}
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="pick a name…"
          required
          minLength={2}
          maxLength={24}
          pattern="[A-Za-z0-9_\-]+"
          autoComplete="username"
          autoFocus
        />
      </label>
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? 'Turning the page…' : 'Enter the Realm'}
      </button>
      <p className={styles.switchText}>
        New names start a new adventure — existing ones pick up where you left off.
      </p>
    </form>
  );
}
