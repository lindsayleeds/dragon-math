import { useState } from 'react';
import { LoginForm } from '../components/auth/LoginForm';
import { SignupForm } from '../components/auth/SignupForm';
import styles from '../styles/AuthPage.module.css';

export function AuthPage() {
  const [mode, setMode] = useState('login');

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoEmoji}>🐉</span>
          <h1 className={styles.logoTitle}>Dragon Math</h1>
          <p className={styles.logoSub}>Math Adventures Await</p>
        </div>
        {mode === 'login'
          ? <LoginForm onSwitch={() => setMode('signup')} />
          : <SignupForm onSwitch={() => setMode('login')} />
        }
      </div>
    </div>
  );
}
