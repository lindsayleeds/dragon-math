import { SignInForm } from '../components/auth/SignInForm';
import styles from '../styles/AuthPage.module.css';

export function AuthPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoEmoji}>🐉</span>
          <h1 className={styles.logoTitle}>Dragon Math</h1>
          <p className={styles.logoSub}>Math Adventures Await</p>
        </div>
        <SignInForm />
      </div>
    </div>
  );
}
