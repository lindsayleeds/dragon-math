import { useState, useEffect, useCallback, useRef } from 'react';
import styles from '../styles/DragonEggHatchery.module.css';
import { api } from '../api';

/**
 * DragonEggHatchery
 *
 * A game component where the player solves 12 math problems to hatch dragon eggs.
 * Each correct answer causes an egg to crack, hatch, and add a baby dragon to the collection.
 *
 * @param {Object} props
 * @param {string} props.operation - Math operation: 'mul', 'div', 'add', 'sub'
 * @param {number} props.baseNumber - The base number (1-12) for all problems
 * @param {Function} props.onComplete - Callback when all 12 eggs are hatched: onComplete(babyDragons)
 */
export function DragonEggHatchery({ operation, baseNumber, onComplete }) {
  // ====== STATE ======
  const [problems, setProblems] = useState([]);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [hatchedCount, setHatchedCount] = useState(0);
  const [babyDragons, setBabyDragons] = useState([]);
  const [lastFeedback, setLastFeedback] = useState(null); // 'correct' | 'wrong' | null
  const [answerButtons, setAnswerButtons] = useState([]);
  const [selectedButtonIndex, setSelectedButtonIndex] = useState(null);
  const [isHatching, setIsHatching] = useState(false);
  const [completedProblems, setCompletedProblems] = useState(new Set());
  const [hintLevel, setHintLevel] = useState(0);
  const [showHintOffer, setShowHintOffer] = useState(false);
  const [hintTimerId, setHintTimerId] = useState(null);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [showAchievementScreen, setShowAchievementScreen] = useState(false);
  const [masteryTier, setMasteryTier] = useState(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // ====== INITIALIZE PROBLEMS ======
  // The pool of dragon ids a hatched egg can become — the active (non-retired)
  // catalog, so newly uploaded dragons can hatch and retired ones can't. Held in
  // a ref so the hatch-animation timeout always reads the latest pool. Falls
  // back to the legacy contiguous range until the catalog loads.
  const dragonPoolRef = useRef(null);
  useEffect(() => {
    api.get('/api/dragons/catalog')
      .then(({ dragons }) => {
        const ids = (dragons || []).map(d => d.dragon_id);
        if (ids.length) dragonPoolRef.current = ids;
      })
      .catch(() => { /* fall back to the contiguous range */ });
  }, []);

  useEffect(() => {
    const generatedProblems = generateProblems(operation, baseNumber);
    setProblems(generatedProblems);
    setCurrentProblemIndex(0);
    setHatchedCount(0);
    setBabyDragons([]);
    setCompletedProblems(new Set());
    setGameStartTime(Date.now());
    setShowAchievementScreen(false);
    setMasteryTier(null);
  }, [operation, baseNumber]);

  // ====== GENERATE ANSWER BUTTONS ======
  useEffect(() => {
    if (problems.length > 0 && currentProblemIndex < problems.length) {
      const current = problems[currentProblemIndex];
      const buttons = generateAnswerButtons(current.correctAnswer);
      // Shuffle the buttons
      const shuffled = [...buttons].sort(() => Math.random() - 0.5);
      setAnswerButtons(shuffled);
      setLastFeedback(null);
      setSelectedButtonIndex(null);
      setIsHatching(false);
      setHintLevel(0);
      setShowHintOffer(false);

      // Set timer to offer hint after 5-7s of no input
      if (hintTimerId) clearTimeout(hintTimerId);
      const timerId = setTimeout(() => {
        setShowHintOffer(true);
      }, 5000 + Math.random() * 2000); // 5-7s
      setHintTimerId(timerId);
    }
  }, [problems, currentProblemIndex]);

  // ====== PERSIST HATCHED DRAGONS TO THE COLLECTION ======
  // Fires once when the achievement screen appears (all 12 eggs hatched). By
  // then `babyDragons` is fully populated, so we save every hatched dragon to
  // the player's permanent collection. Best-effort: a failure here never blocks
  // the celebration screen.
  useEffect(() => {
    if (!showAchievementScreen) return;
    const dragonIds = babyDragons.map(d => d.dragonId).filter(Boolean);
    if (dragonIds.length === 0) return;
    api.post('/api/dragons/collect', { dragon_ids: dragonIds })
      .catch(err => console.error('Failed to save dragon collection:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAchievementScreen]);

  // ====== HANDLE ANSWER SELECTION ======
  const handleAnswerClick = useCallback(
    (answerValue, buttonIdx) => {
      if (isHatching) return; // Prevent clicking during animation

      const currentProblem = problems[currentProblemIndex];
      if (!currentProblem) return;

      // Clear hint timer and offer when they click an answer
      if (hintTimerId) clearTimeout(hintTimerId);
      setHintTimerId(null);
      setShowHintOffer(false);

      setSelectedButtonIndex(buttonIdx);

      if (answerValue === currentProblem.correctAnswer) {
        // CORRECT ANSWER
        setLastFeedback('correct');
        setIsHatching(true);
        setCompletedProblems(prev => new Set([...prev, currentProblem.id]));

        // Hatch animation delay before moving to next
        setTimeout(() => {
          const dragonId = getRandomDragonId(dragonPoolRef.current);
          const newBabyDragon = {
            id: Math.random(),
            dragonId,
            image: `/dragon_pngs/${dragonId}.png`,
            problemId: currentProblem.id,
            baseNumber,
            operation,
          };
          setBabyDragons(prev => [...prev, newBabyDragon]);
          setHatchedCount(prev => {
            const newCount = prev + 1;
            // Check if all 12 are hatched
            if (newCount === 12) {
              setTimeout(async () => {
                const elapsedSeconds = (Date.now() - gameStartTime) / 1000;
                const tier = calculateMasteryTier(elapsedSeconds);
                setMasteryTier(tier);

                // Save game result to server
                try {
                  const gameProblems = problems.map(p => ({
                    multiplier: p.multiplier,
                    outcome: 'child' // All problems solved correctly in hatchery
                  }));

                  console.log('Saving game result:', { operation, baseNumber, count: gameProblems.length, time: elapsedSeconds });
                  const result = await api.post('/api/game-result', {
                    operation,
                    base_number: baseNumber,
                    problems: gameProblems,
                    time_ms: elapsedSeconds * 1000
                  });
                  console.log('Game result saved successfully:', result);
                } catch (err) {
                  console.error('Failed to save game result:', err);
                }

                setShowAchievementScreen(true);
              }, 300);
            }
            return newCount;
          });

          // Move to next problem if not done
          if (currentProblemIndex < problems.length - 1) {
            setCurrentProblemIndex(prev => prev + 1);
          }

          setIsHatching(false);
        }, 800); // Time for egg crack animation
      } else {
        // WRONG ANSWER
        setLastFeedback('wrong');

        // Dim button and reset after 500ms
        setTimeout(() => {
          setSelectedButtonIndex(null);
          setLastFeedback(null);
        }, 500);
      }
    },
    [problems, currentProblemIndex, isHatching, babyDragons, baseNumber, operation, onComplete, hintTimerId]
  );

  // ====== HANDLE HINT CLICK ======
  const handleHintClick = useCallback(() => {
    setHintLevel(hintLevel === 0 ? 1 : 0);
  }, [hintLevel]);

  // ====== RENDER ======
  if (problems.length === 0) {
    return <div className={styles.loadingScreen}>Loading...</div>;
  }

  if (showAchievementScreen) {
    return (
      <div className={styles.container}>
        <div className={styles.achievementScreen}>
          <div className={styles.achievementContent}>
            <div className={styles.tierBadge} data-tier={masteryTier.tier}>
              {masteryTier.icon}
            </div>
            <h2 className={styles.achievementTitle}>{masteryTier.label}</h2>
            <p className={styles.achievementSubtitle}>{masteryTier.message}</p>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Time</span>
                <span className={styles.statValue}>{masteryTier.timeDisplay}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Score</span>
                <span className={styles.statValue}>12/12</span>
              </div>
            </div>
            <div className={styles.dragonGrid}>
              {babyDragons.map(dragon => (
                <div key={dragon.id} className={styles.dragonSlot}>
                  <img src={dragon.image} alt="Baby dragon" className={styles.dragonImg} />
                </div>
              ))}
            </div>
            <button
              className={styles.continueButton}
              onClick={() => {
                setShowAchievementScreen(false);
                if (onComplete) {
                  onComplete(babyDragons);
                }
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentProblem = problems[currentProblemIndex];
  if (!currentProblem) {
    return null; // Should not happen due to onComplete callback, but safety
  }

  return (
    <div className={styles.container}>
      {/* Progress Bar */}
      <div className={styles.progressSection}>
        <div className={styles.progressLabel}>
          Eggs Hatched: <span className={styles.progressCount}>{hatchedCount}/12</span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${(hatchedCount / 12) * 100}%` }}
          />
        </div>
        <button
          className={styles.quitButton}
          onClick={() => setShowQuitConfirm(true)}
          aria-label="Quit game"
        >
          ← Quit
        </button>
      </div>

      {/* Current Problem Card */}
      <div className={styles.problemCard}>
        <div className={styles.eggContainer}>
          <div className={`${styles.egg} ${isHatching ? styles.eggCracking : ''}`}>
            🥚
          </div>
        </div>
        <div className={styles.problemText}>
          {baseNumber} {getOperationSymbol(operation)} {currentProblem.multiplier}
          {lastFeedback === 'correct' && (
            <span className={styles.answerReveal}>
              {' '}= {currentProblem.correctAnswer}
            </span>
          )}
        </div>
        {lastFeedback && (
          <div className={`${styles.feedback} ${styles[`feedback_${lastFeedback}`]}`}>
            {lastFeedback === 'correct' ? '✓ Correct!' : '✗ Try again!'}
          </div>
        )}

        {hintLevel > 0 && (
          <div className={styles.hintText}>
            💡 {getHintText(operation, baseNumber, currentProblem.multiplier, hintLevel)}
          </div>
        )}
      </div>

      {/* Answer Buttons */}
      <div className={styles.answersGrid}>
        {answerButtons.map((answer, idx) => (
          <button
            key={`${currentProblem.id}-${idx}`}
            className={`${styles.answerButton} ${
              selectedButtonIndex === idx
                ? lastFeedback === 'correct'
                  ? styles.correct
                  : styles.wrong
                : ''
            }`}
            onClick={() => handleAnswerClick(answer, idx)}
            disabled={isHatching || lastFeedback === 'correct'}
          >
            {answer}
          </button>
        ))}
      </div>

      {/* Hint Button */}
      {(showHintOffer || hintLevel > 0) && (
        <div className={styles.hintButtonContainer}>
          <button
            className={styles.hintButton}
            onClick={handleHintClick}
            aria-label={hintLevel === 0 ? 'Get a hint' : 'Hide hint'}
          >
            {hintLevel === 0 ? '🐉 Need a hand?' : '🐉 Hide hint'}
          </button>
        </div>
      )}

      {/* Baby Dragons Collection */}
      <div className={styles.dragonsSection}>
        <div className={styles.dragonsLabel}>🐉 Babies Collected:</div>
        <div className={styles.dragonGrid}>
          {babyDragons.map(dragon => (
            <div key={dragon.id} className={styles.dragonSlot}>
              <img src={dragon.image} alt="Baby dragon" className={styles.dragonImg} />
            </div>
          ))}
          {/* Empty slots for visual feedback */}
          {Array.from({ length: 12 - babyDragons.length }).map((_, idx) => (
            <div key={`empty-${idx}`} className={styles.emptySlot} />
          ))}
        </div>
      </div>

      {/* Quit Confirmation Modal */}
      {showQuitConfirm && (
        <div className={styles.quitModal}>
          <div className={styles.quitModalContent}>
            <p>Are you sure you want to quit?</p>
            <div className={styles.quitModalButtons}>
              <button
                className={styles.quitConfirmBtn}
                onClick={() => onComplete()}
              >
                Yes, quit
              </button>
              <button
                className={styles.quitCancelBtn}
                onClick={() => setShowQuitConfirm(false)}
              >
                Keep playing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ====== HELPER FUNCTIONS ======

/**
 * Calculate mastery tier based on completion time
 */
function calculateMasteryTier(elapsedSeconds) {
  if (elapsedSeconds < 15) {
    return {
      tier: 'legendary',
      icon: '💎',
      label: 'Mastered!',
      message: 'Incredible! You completely mastered this!',
      timeDisplay: formatTime(elapsedSeconds),
    };
  }
  if (elapsedSeconds < 25) {
    return {
      tier: 'gold',
      icon: '⭐',
      label: 'Almost Mastered!',
      message: 'Excellent work! You\'re almost there!',
      timeDisplay: formatTime(elapsedSeconds),
    };
  }
  if (elapsedSeconds < 40) {
    return {
      tier: 'silver',
      icon: '✨',
      label: 'Getting There!',
      message: 'Great job! Keep practicing!',
      timeDisplay: formatTime(elapsedSeconds),
    };
  }
  return {
    tier: 'bronze',
    icon: '🌱',
    label: 'Keep Practicing!',
    message: 'Good effort! Practice makes perfect!',
    timeDisplay: formatTime(elapsedSeconds),
  };
}

/**
 * Format seconds into a readable time string
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}

/**
 * Generate 12 problems: baseNumber op 1, baseNumber op 2, ..., baseNumber op 12
 */
function generateProblems(operation, baseNumber) {
  const problems = [];
  for (let i = 1; i <= 12; i++) {
    const answer = calculateAnswer(baseNumber, i, operation);
    problems.push({
      id: i,
      multiplier: i,
      correctAnswer: answer,
      isHatched: false,
    });
  }
  // Shuffle the problems
  return problems.sort(() => Math.random() - 0.5);
}

/**
 * Calculate the answer based on operation
 */
function calculateAnswer(baseNumber, multiplier, operation) {
  switch (operation) {
    case 'mul':
      return baseNumber * multiplier;
    case 'div':
      return Math.floor(baseNumber / multiplier);
    case 'add':
      return baseNumber + multiplier;
    case 'sub':
      return Math.max(0, baseNumber - multiplier); // Avoid negatives for kids
    default:
      return 0;
  }
}

/**
 * Generate 4 answer buttons: 1 correct + 3 distractors
 */
function generateAnswerButtons(correctAnswer) {
  const buttons = [correctAnswer];
  const used = new Set([correctAnswer]);

  // Distractor strategies
  const distractors = [];

  // Off-by-one: ±1, ±2
  distractors.push(correctAnswer - 1);
  distractors.push(correctAnswer + 1);
  distractors.push(correctAnswer - 2);
  distractors.push(correctAnswer + 2);

  // Random plausible values (within a reasonable range)
  const min = Math.max(1, correctAnswer - 5);
  const max = correctAnswer + 5;
  for (let i = 0; i < 4; i++) {
    distractors.push(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  // Pick 3 unique distractors
  const uniqueDistractors = [...new Set(distractors)].filter(d => d !== correctAnswer && d > 0);

  while (buttons.length < 4 && uniqueDistractors.length > 0) {
    const idx = Math.floor(Math.random() * uniqueDistractors.length);
    buttons.push(uniqueDistractors[idx]);
    uniqueDistractors.splice(idx, 1);
  }

  return buttons;
}

/**
 * Get the operation symbol
 */
function getOperationSymbol(operation) {
  const symbols = {
    mul: '×',
    div: '÷',
    add: '+',
    sub: '−',
  };
  return symbols[operation] || '×';
}

/**
 * Number of dragon images available in /public/dragon_pngs (1.png … N.png)
 */
const DRAGON_PNG_COUNT = 253;

/**
 * Get a random baby dragon image id. Prefers the live active-catalog `pool`
 * (so uploaded dragons can hatch and retired ones can't); falls back to the
 * legacy contiguous range (1 … DRAGON_PNG_COUNT) before the catalog loads.
 * Maps to /public/dragon_pngs/<id>.png and to a row in the dragon collection.
 */
function getRandomDragonId(pool) {
  if (Array.isArray(pool) && pool.length) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return Math.floor(Math.random() * DRAGON_PNG_COUNT) + 1;
}

/**
 * Generate hint text based on operation and current problem
 * For multiplication, shows skip-count with 2-4 extra numbers beyond the answer
 * Never exceeds 15×
 */
function getHintText(operation, baseNumber, multiplier, hintLevel) {
  if (operation !== 'mul' || hintLevel === 0) {
    return null;
  }

  // Generate skip-count from 1 to multiplier (answer)
  const counts = [];
  for (let i = 1; i <= multiplier; i++) {
    counts.push(baseNumber * i);
  }

  // Add 2-4 random extra numbers beyond the answer, capped at 15×
  const extraCount = Math.floor(Math.random() * 3) + 2; // 2-4 extra
  const maxMultiplier = Math.min(15, multiplier + extraCount);

  for (let i = multiplier + 1; i <= maxMultiplier; i++) {
    counts.push(baseNumber * i);
  }

  return `Skip-count: ${counts.join(', ')}`;
}
