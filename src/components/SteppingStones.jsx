import { useState, useCallback } from 'react';
import styles from '../styles/SteppingStones.module.css';
import { soundEffects } from '../utils/soundEffects';

const NUM_STONES = 10;
const CHOICES_PER_HOP = 4;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Each hop offers the correct next multiple alongside plausible distractors:
// off-by-one/two skip-count slips and the tempting "over-skip" to the multiple
// after the target. The kid has to work out which pad is the true next multiple.
function generateHops(baseNumber) {
  const hops = [];
  for (let i = 1; i <= NUM_STONES; i++) {
    const target = baseNumber * i;
    const candidates = [
      target + 1,
      target - 1,
      target + 2,
      target - 2,
      target + baseNumber, // over-skip: the multiple *after* this one
      target + baseNumber + 1,
    ];
    const pool = [];
    for (const c of candidates) {
      if (c > 0 && c !== target && !pool.includes(c)) pool.push(c);
    }
    const distractors = shuffle(pool).slice(0, CHOICES_PER_HOP - 1);
    const choices = shuffle([
      { value: target, isCorrect: true },
      ...distractors.map((value) => ({ value, isCorrect: false })),
    ]);
    hops.push({ target, choices });
  }
  return hops;
}

export function SteppingStones({ baseNumber, onComplete }) {
  const [hops] = useState(() => generateHops(baseNumber));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [sunkValues, setSunkValues] = useState(new Set());
  const [streak, setStreak] = useState(0);
  const [splashValue, setSplashValue] = useState(null);

  const currentHop = hops[currentIndex];

  const handleStoneClick = useCallback(
    (choice) => {
      if (gameOver) return;

      if (choice.isCorrect) {
        soundEffects.playCorrect();
        setSplashValue(choice.value);
        setTimeout(() => setSplashValue(null), 600);
        setSunkValues(new Set());
        setStreak((prev) => prev + 1);
        setCurrentIndex((prev) => {
          const newIndex = prev + 1;
          if (newIndex === NUM_STONES) {
            setGameOver(true);
            setWon(true);
          }
          return newIndex;
        });
      } else {
        soundEffects.playWrong();
        setIncorrectTaps((prev) => prev + 1);
        setStreak(0);
        setSunkValues((prev) => new Set([...prev, choice.value]));

        setTimeout(() => {
          setSunkValues((prev) => {
            const updated = new Set(prev);
            updated.delete(choice.value);
            return updated;
          });
        }, 600);
      }
    },
    [gameOver]
  );

  if (gameOver) {
    return (
      <div className={styles.container}>
        <div className={styles.gameOverScreen}>
          <div className={styles.gameOverIcon}>{won ? '💎' : '🌊'}</div>
          <h2 className={styles.gameOverTitle}>
            {won ? 'You crossed the river!' : 'The river swept you back!'}
          </h2>
          <div className={styles.gameOverScore}>
            {won
              ? `All ${NUM_STONES} numbers in the ${baseNumber}× sequence!`
              : `You made it ${currentIndex} stones across`}
          </div>
          <button className={styles.restartButton} onClick={() => onComplete?.()}>
            Back to the Lair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${(currentIndex / NUM_STONES) * 100}%` }}
          />
        </div>
        <div className={styles.headerText}>
          {currentIndex}/{NUM_STONES} stones
          {incorrectTaps > 0 && ` · Ripples: ${incorrectTaps}`}
        </div>
        <button
          className={styles.quitButton}
          onClick={() => setShowQuitConfirm(true)}
          aria-label="Quit game"
        >
          ← Quit
        </button>
      </div>

      <div className={styles.scene}>
        <div className={styles.bank}>🌿 Near Bank</div>

        {/* Running trail of locked multiples so the pattern is visible */}
        <div className={styles.trail}>
          {currentIndex === 0 ? (
            <span className={styles.trailHint}>Start the count…</span>
          ) : (
            hops.slice(0, currentIndex).map((hop, idx) => (
              <span key={idx} className={styles.trailDone}>
                {hop.target}
              </span>
            ))
          )}
          <span className={styles.trailCurrent}>🦦 ?</span>
        </div>

        <div className={styles.river}>
          <div className={styles.water} />
          <div className={styles.stonesContainer}>
            {currentHop.choices.map((choice, idx) => {
              const isSinking = sunkValues.has(choice.value);
              const hasSplash = splashValue === choice.value;

              return (
                <div key={`${currentIndex}-${idx}`} className={styles.stoneWrapper}>
                  {hasSplash && <div className={styles.splash} />}
                  <button
                    className={`${styles.stone} ${isSinking ? styles.sinking : ''}`}
                    onClick={() => handleStoneClick(choice)}
                    disabled={isSinking}
                    aria-label={`Stone with ${choice.value}`}
                  >
                    {!isSinking && <span className={styles.number}>{choice.value}</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className={styles.water} />
        </div>

        <div className={styles.bank}>Far Bank 🌿</div>
      </div>

      {streak > 0 && <div className={styles.streakDisplay}>🔥 {streak} in a row!</div>}

      <div className={styles.instructions}>
        Tap the next number in the {baseNumber}× count: {baseNumber}, {baseNumber * 2},{' '}
        {baseNumber * 3}…
      </div>

      {showQuitConfirm && (
        <div className={styles.quitModal}>
          <div className={styles.quitModalContent}>
            <p>Are you sure you want to go back?</p>
            <div className={styles.quitModalButtons}>
              <button className={styles.quitConfirmBtn} onClick={() => onComplete?.()}>
                Yes, back to the Lair
              </button>
              <button
                className={styles.quitCancelBtn}
                onClick={() => setShowQuitConfirm(false)}
              >
                Keep crossing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
