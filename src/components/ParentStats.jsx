import styles from '../styles/ParentDashboard.module.css';

// One labelled figure in a parent stats grid. `hint` is an optional second line
// under the value (e.g. "18 of 20 correct").
export function Stat({ label, value, hint }) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {hint && <div className={styles.statLabel}>{hint}</div>}
    </div>
  );
}
