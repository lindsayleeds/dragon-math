import styles from '../styles/MasteryDragon.module.css';

const DRAGON_IMAGES = {
  none: '/assets/dragon-mastery/dragon-new.png',
  new: '/assets/dragon-mastery/dragon-new.png',
  learning: '/avatars/avie_rain.png',
  practicing: '/assets/dragon-mastery/dragon-practicing.png',
  strong: '/assets/dragon-mastery/dragon-strong.png',
  mastered: '/assets/dragon-mastery/dragon-mastered.png',
};

export function MasteryDragon({ tier, number, size }) {
  const dragonImage = DRAGON_IMAGES[tier];
  // The legend renders compact swatches; pass `size` to shrink the artwork
  // instead of clipping a full-size card.
  const containerStyle = size ? { width: size, height: size } : undefined;

  return (
    <div className={`${styles.dragonCell} ${styles[`tier_${tier}`]}`}>
      <div className={styles.dragonContainer} style={containerStyle}>
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
