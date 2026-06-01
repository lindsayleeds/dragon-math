import { FatDragonAvatar } from '../components/FatDragonAvatar';
import styles from '../styles/FatDragonPreview.module.css';

export function FatDragonPreviewPage() {
  const previewNumbers = [1, 2, 3, 4, 5, 10, 12];
  const sizes = ['small', 'medium', 'large', 'xlarge'];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Fat Dragon Avatar Preview</h1>
        <p>Hand-drawn sketch-journal dragon with a belly perfect for displaying mastery levels</p>
      </div>

      {/* Different sizes showcase */}
      <section className={styles.section}>
        <h2>Size Variants</h2>
        <div className={styles.sizeShowcase}>
          {sizes.map(size => (
            <div key={size} className={styles.sizeItem}>
              <FatDragonAvatar number={7} size={size} />
              <p>{size}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Numbers in belly */}
      <section className={styles.section}>
        <h2>Numbers in Belly (Medium Size)</h2>
        <div className={styles.numbersShowcase}>
          {previewNumbers.map(num => (
            <div key={num} className={styles.numberItem}>
              <FatDragonAvatar number={num} size="medium" />
            </div>
          ))}
        </div>
      </section>

      {/* Without number */}
      <section className={styles.section}>
        <h2>Without Number</h2>
        <div className={styles.singleItem}>
          <FatDragonAvatar size="large" />
        </div>
      </section>

      {/* Usage guide */}
      <section className={styles.section}>
        <h2>Usage</h2>
        <pre className={styles.code}>
          {`import { FatDragonAvatar } from './components/FatDragonAvatar';

// With number
<FatDragonAvatar number={5} size="medium" />

// Without number
<FatDragonAvatar size="large" />

// Size options: 'small' | 'medium' | 'large' | 'xlarge'`}
        </pre>
      </section>
    </div>
  );
}
