import styles from '../styles/MasteryDragon.module.css';

const DRAGON_IMAGES = {
  none: '/assets/dragon-mastery/dragon-new.png',
  new: '/assets/dragon-mastery/dragon-new.png',
  learning: '/assets/dragon-mastery/dragon-learning.png',
  practicing: '/assets/dragon-mastery/dragon-practicing.png',
  strong: '/assets/dragon-mastery/dragon-strong.png',
  mastered: '/assets/dragon-mastery/dragon-mastered.png',
};

export function MasteryDragon({ tier, number, color }) {
  const dragonImage = DRAGON_IMAGES[tier];

  return (
    <div className={`${styles.dragonCell} ${styles[`tier_${tier}`]}`}>
      <div className={styles.dragonContainer}>
        <img
          src={dragonImage}
          alt={`Dragon level ${tier}`}
          className={styles.dragonImage}
        />
      </div>
      <div className={styles.numberLabel}>{number}</div>
    </div>
  );
}
