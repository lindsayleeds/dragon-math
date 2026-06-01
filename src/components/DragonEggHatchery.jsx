import { useState, useEffect, useCallback } from 'react';
import styles from '../styles/DragonEggHatchery.module.css';

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

  // ====== INITIALIZE PROBLEMS ======
  useEffect(() => {
    const generatedProblems = generateProblems(operation, baseNumber);
    setProblems(generatedProblems);
    setCurrentProblemIndex(0);
    setHatchedCount(0);
    setBabyDragons([]);
    setCompletedProblems(new Set());
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
    }
  }, [problems, currentProblemIndex]);

  // ====== HANDLE ANSWER SELECTION ======
  const handleAnswerClick = useCallback(
    (answerValue, buttonIdx) => {
      if (isHatching) return; // Prevent clicking during animation

      const currentProblem = problems[currentProblemIndex];
      if (!currentProblem) return;

      setSelectedButtonIndex(buttonIdx);

      if (answerValue === currentProblem.correctAnswer) {
        // CORRECT ANSWER
        setLastFeedback('correct');
        setIsHatching(true);
        setCompletedProblems(prev => new Set([...prev, currentProblem.id]));

        // Hatch animation delay before moving to next
        setTimeout(() => {
          const newBabyDragon = {
            id: Math.random(),
            emoji: getRandomDragonEmoji(),
            problemId: currentProblem.id,
            baseNumber,
            operation,
          };
          setBabyDragons(prev => [...prev, newBabyDragon]);
          setHatchedCount(prev => {
            const newCount = prev + 1;
            // Check if all 12 are hatched
            if (newCount === 12 && onComplete) {
              setTimeout(() => {
                onComplete([...babyDragons, newBabyDragon]);
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
    [problems, currentProblemIndex, isHatching, babyDragons, baseNumber, operation, onComplete]
  );

  // ====== RENDER ======
  if (problems.length === 0) {
    return <div className={styles.loadingScreen}>Loading...</div>;
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
        </div>
        {lastFeedback && (
          <div className={`${styles.feedback} ${styles[`feedback_${lastFeedback}`]}`}>
            {lastFeedback === 'correct' ? '✓ Correct!' : '✗ Try again!'}
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

      {/* Baby Dragons Collection */}
      <div className={styles.dragonsSection}>
        <div className={styles.dragonsLabel}>🐉 Babies Collected:</div>
        <div className={styles.dragonGrid}>
          {babyDragons.map(dragon => (
            <div key={dragon.id} className={styles.dragonSlot}>
              {dragon.emoji}
            </div>
          ))}
          {/* Empty slots for visual feedback */}
          {Array.from({ length: 12 - babyDragons.length }).map((_, idx) => (
            <div key={`empty-${idx}`} className={styles.emptySlot} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ====== HELPER FUNCTIONS ======

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
      return Math.floor(baseNumber * multiplier / baseNumber); // Simplification for now
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
 * Get a random baby dragon emoji
 */
function getRandomDragonEmoji() {
  const dragons = ['🐉', '🦕', '🦖', '🐲'];
  return dragons[Math.floor(Math.random() * dragons.length)];
}
