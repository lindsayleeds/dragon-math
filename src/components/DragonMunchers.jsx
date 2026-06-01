import { useState, useEffect, useCallback, useMemo } from 'react';
import styles from '../styles/DragonMunchers.module.css';
import { soundEffects } from '../utils/soundEffects';
import { FatDragonAvatar } from './FatDragonAvatar';
import { MonsterMuncher } from './MonsterMuncher';

const GRID_COLS = 5;
const GRID_ROWS = 6;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
const NUM_CORRECT_ANSWERS = 10;
const MOVE_INTERVAL = 200;
const ENEMY_MOVE_INTERVAL = 3000;
// How long the monster "looks" toward its next cell before it actually moves.
const ENEMY_TELEGRAPH = 750;
const SPAWN_INTERVAL = 4000;

function getCorrectAnswers(operation, baseNumber) {
  const answers = [];
  if (operation === 'mul') {
    for (let i = 1; i <= NUM_CORRECT_ANSWERS; i++) {
      answers.push(baseNumber * i);
    }
  } else if (operation === 'add') {
    for (let i = 1; i <= NUM_CORRECT_ANSWERS; i++) {
      answers.push(baseNumber + i);
    }
  } else if (operation === 'sub') {
    for (let i = 1; i <= NUM_CORRECT_ANSWERS; i++) {
      answers.push(baseNumber - i);
    }
  } else if (operation === 'div') {
    for (let i = 1; i <= NUM_CORRECT_ANSWERS; i++) {
      answers.push(Math.floor(baseNumber / i));
    }
  }
  return answers;
}

function getGameTitle(operation, baseNumber) {
  switch (operation) {
    case 'mul':
      return `Multiples of ${baseNumber}`;
    case 'add':
      return `Adding ${baseNumber}`;
    case 'sub':
      return `Subtracting ${baseNumber}`;
    case 'div':
      return `Dividing by ${baseNumber}`;
    default:
      return 'Dragon Munchers';
  }
}

function getWrongAnswerMessage(operation, baseNumber, wrongNumber) {
  switch (operation) {
    case 'mul':
      return `${wrongNumber} is not a multiple of ${baseNumber}`;
    case 'add':
      return `${baseNumber} + ? does not equal ${wrongNumber}`;
    case 'sub':
      return `${baseNumber} − ? does not equal ${wrongNumber}`;
    case 'div':
      return `${baseNumber} ÷ ? does not equal ${wrongNumber}`;
    default:
      return 'That\'s not correct!';
  }
}

export function DragonMunchers({ operation, baseNumber, onComplete }) {
  const [muncher, setMuncher] = useState(TOTAL_CELLS - 1);
  const [enemies, setEnemies] = useState([]);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [nextEnemyId, setNextEnemyId] = useState(0);
  const [correctAnswersEaten, setCorrectAnswersEaten] = useState(0);
  const [babyDragons, setBabyDragons] = useState([]);
  const [eatenPositions, setEatenPositions] = useState(new Set());
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [wrongAnswerMsg, setWrongAnswerMsg] = useState(null);

  const gridNumbers = useMemo(() => {
    const correctAnswers = getCorrectAnswers(operation, baseNumber);
    const grid = Array(TOTAL_CELLS).fill(null);

    const positions = Array.from({ length: TOTAL_CELLS }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    for (let i = 0; i < NUM_CORRECT_ANSWERS; i++) {
      grid[positions[i]] = { value: correctAnswers[i], isCorrect: true };
    }

    for (let i = NUM_CORRECT_ANSWERS; i < TOTAL_CELLS; i++) {
      let incorrect = Math.floor(Math.random() * 100) + 1;
      while (correctAnswers.includes(incorrect)) {
        incorrect = Math.floor(Math.random() * 100) + 1;
      }
      grid[positions[i]] = { value: incorrect, isCorrect: false };
    }

    return grid;
  }, [operation, baseNumber]);

  // Handle muncher movement
  const moveMuncher = useCallback((direction) => {
    setMuncher(prev => {
      const row = Math.floor(prev / GRID_COLS);
      const col = prev % GRID_COLS;
      let newRow = row;
      let newCol = col;

      if (direction === 'up' && row > 0) newRow--;
      else if (direction === 'down' && row < GRID_ROWS - 1) newRow++;
      else if (direction === 'left' && col > 0) newCol--;
      else if (direction === 'right' && col < GRID_COLS - 1) newCol++;

      return newRow * GRID_COLS + newCol;
    });
  }, []);

  // Handle keyboard input
  useEffect(() => {
    if (gameOver) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault();
        moveMuncher('up');
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault();
        moveMuncher('down');
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        moveMuncher('left');
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        e.preventDefault();
        moveMuncher('right');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameOver, moveMuncher]);

  // Handle touch controls for mobile
  const handleTouchStart = useCallback((e) => {
    if (gameOver) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 30) { // Deadzone
      if (Math.abs(dx) > Math.abs(dy)) {
        moveMuncher(dx > 0 ? 'right' : 'left');
      } else {
        moveMuncher(dy > 0 ? 'down' : 'up');
      }
    }
  }, [gameOver, moveMuncher]);

  // Spawn enemies periodically
  useEffect(() => {
    if (gameOver) return;

    const spawnTimer = setInterval(() => {
      setNextEnemyId(prev => prev + 1);
      const newPosition = Math.floor(Math.random() * TOTAL_CELLS);
      setEnemies(prev => [...prev, { id: nextEnemyId, position: newPosition, facing: 'center' }]);
    }, SPAWN_INTERVAL);

    return () => clearInterval(spawnTimer);
  }, [gameOver, nextEnemyId]);

  const eatNumber = useCallback(() => {
    if (eatenPositions.has(muncher)) return;

    const cellData = gridNumbers[muncher];
    if (cellData?.value == null) return;

    setEatenPositions(prev => new Set([...prev, muncher]));

    if (cellData.isCorrect) {
      soundEffects.playCorrect();
      const newCount = correctAnswersEaten + 1;
      setCorrectAnswersEaten(newCount);

      setBabyDragons(prev => [...prev, { id: newCount, emoji: getRandomDragonEmoji() }]);

      // Check if we've won
      if (newCount === NUM_CORRECT_ANSWERS) {
        setGameOver(true);
      }
    } else {
      // Wrong answer - show message
      soundEffects.playWrong();
      setWrongAnswerMsg(getWrongAnswerMessage(operation, baseNumber, cellData.value));
    }
  }, [muncher, gridNumbers, correctAnswersEaten, eatenPositions, operation, baseNumber]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameOver) return;
      if (e.code === 'Space') {
        e.preventDefault();
        eatNumber();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [eatNumber, gameOver]);

  // Move enemies periodically and check collisions.
  // Each cycle has two beats: first the monster turns to look at the cell it's
  // about to move into (the telegraph), then after a short pause it actually
  // moves and we check for collisions.
  useEffect(() => {
    if (gameOver) return;

    let commitTimer;

    const enemyTimer = setInterval(() => {
      // Beat 1 — plan each monster's next step and turn it to face that way.
      setEnemies(prev => prev.map(enemy => {
        const plan = planEnemyMove(enemy.position, muncher);
        return { ...enemy, facing: plan.facing, nextPosition: plan.newPosition };
      }));

      // Beat 2 — after the telegraph, commit the move and check collisions.
      commitTimer = setTimeout(() => {
        setEnemies(prev => {
          const updated = prev.map(enemy => ({
            ...enemy,
            position: enemy.nextPosition ?? enemy.position,
            facing: 'center', // settle back to looking dead-on between moves
          }));

          const collision = updated.some(enemy => enemy.position === muncher);
          if (collision) {
            soundEffects.playCollision();
            setLives(l => {
              const newLives = l - 1;
              if (newLives <= 0) {
                setGameOver(true);
              }
              return newLives;
            });
            setMuncher(TOTAL_CELLS - 1);
            return updated.filter(enemy => enemy.position !== muncher);
          }

          return updated;
        });
      }, ENEMY_TELEGRAPH);
    }, ENEMY_MOVE_INTERVAL);

    return () => {
      clearInterval(enemyTimer);
      clearTimeout(commitTimer);
    };
  }, [muncher, gameOver]);

  // Increment score every second
  useEffect(() => {
    if (gameOver) return;

    const scoreTimer = setInterval(() => {
      setScore(s => s + 1);
    }, 1000);

    return () => clearInterval(scoreTimer);
  }, [gameOver]);

  // Handle button clicks for mobile
  const handleButtonClick = useCallback((direction) => {
    moveMuncher(direction);
  }, [moveMuncher]);

  // Handle cell clicks for mobile movement
  const handleCellClick = useCallback((cellIndex) => {
    if (gameOver) return;

    // If clicking on current muncher cell, eat the number
    if (cellIndex === muncher) {
      eatNumber();
      return;
    }

    // Check if clicked cell is adjacent (within 1 cell distance)
    const munRow = Math.floor(muncher / GRID_COLS);
    const munCol = muncher % GRID_COLS;
    const cellRow = Math.floor(cellIndex / GRID_COLS);
    const cellCol = cellIndex % GRID_COLS;

    const rowDiff = Math.abs(munRow - cellRow);
    const colDiff = Math.abs(munCol - cellCol);

    // Only allow moving to cells directly adjacent (up/down/left/right, not diagonal)
    if ((rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1)) {
      if (cellRow < munRow) moveMuncher('up');
      else if (cellRow > munRow) moveMuncher('down');
      else if (cellCol < munCol) moveMuncher('left');
      else if (cellCol > munCol) moveMuncher('right');
    }
  }, [muncher, gameOver, eatNumber, moveMuncher]);

  if (gameOver) {
    const won = correctAnswersEaten === NUM_CORRECT_ANSWERS;
    return (
      <div className={styles.container}>
        <div className={styles.gameOverScreen}>
          <div className={styles.gameOverIcon}>{won ? '🎉' : '🐉'}</div>
          <h2 className={styles.gameOverTitle}>
            {won ? 'You won the round!' : "You've been caught!"}
          </h2>
          <div className={styles.gameOverScore}>
            {won
              ? `All 10 answers in ${score} seconds!`
              : `You survived ${score} seconds`}
          </div>
          <button
            className={styles.restartButton}
            onClick={() => onComplete?.(score)}
          >
            Back to the Lair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.progressSection}>
          <div className={styles.dragonGrid}>
            {babyDragons.map(dragon => (
              <div key={dragon.id} className={styles.dragonSlot}>
                {dragon.emoji}
              </div>
            ))}
            {Array.from({ length: 10 - babyDragons.length }).map((_, idx) => (
              <div key={`empty-${idx}`} className={styles.emptySlot} />
            ))}
          </div>
        </div>
        <div className={styles.headerItem}>
          <span className={styles.label}>Lives:</span>
          <span className={styles.lives}>
            {Array.from({ length: lives }).map((_, i) => (
              <span key={i} className={styles.lifeIcon}>❤️</span>
            ))}
          </span>
        </div>
        <button
          className={styles.quitButton}
          onClick={() => setShowQuitConfirm(true)}
          aria-label="Quit game"
        >
          ← Quit
        </button>
      </div>

      <div className={styles.gameTitle}>
        {getGameTitle(operation, baseNumber)}
      </div>

      <div
        className={styles.gameArea}
        onTouchStart={handleTouchStart}
      >
        <div className={styles.grid}>
          {Array.from({ length: TOTAL_CELLS }).map((_, idx) => {
            const cellData = gridNumbers[idx];
            const isMuncher = muncher === idx;
            const hasEnemy = enemies.some(enemy => enemy.position === idx);
            return (
              <div
                key={idx}
                className={styles.cell}
                onClick={() => handleCellClick(idx)}
                style={{ cursor: isMuncher ? 'pointer' : 'grab' }}
              >
                {muncher === idx && (
                  <div className={styles.muncher}>
                    <FatDragonAvatar size="small" />
                  </div>
                )}
                {enemies.map(enemy =>
                  enemy.position === idx ? (
                    <div key={enemy.id} className={styles.enemy}>
                      <MonsterMuncher facing={enemy.facing} size="small" />
                    </div>
                  ) : null
                )}
                {!eatenPositions.has(idx) && !hasEnemy && (
                  <div className={styles.cellNumber}>{cellData?.value}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.directionButton}
          onClick={() => handleButtonClick('up')}
          aria-label="Move up"
        >
          ↑
        </button>
        <div className={styles.controlsRow}>
          <button
            className={styles.directionButton}
            onClick={() => handleButtonClick('left')}
            aria-label="Move left"
          >
            ←
          </button>
          <button
            className={styles.directionButton}
            onClick={() => handleButtonClick('down')}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            className={styles.directionButton}
            onClick={() => handleButtonClick('right')}
            aria-label="Move right"
          >
            →
          </button>
        </div>
      </div>

      <div className={styles.instructions}>
        Use arrow keys or touch to move. Press spacebar or click to eat numbers. Avoid the dragons!
      </div>

      {/* Wrong Answer Modal */}
      {wrongAnswerMsg && (
        <div className={styles.wrongAnswerModal}>
          <div className={styles.wrongAnswerContent}>
            <p className={styles.wrongAnswerMsg}>{wrongAnswerMsg}</p>
            <button
              className={styles.continueBtn}
              onClick={() => {
                setWrongAnswerMsg(null);
                setLives(l => {
                  const newLives = l - 1;
                  if (newLives <= 0) {
                    setGameOver(true);
                  }
                  return newLives;
                });
              }}
            >
              Click to continue
            </button>
          </div>
        </div>
      )}

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

function getRandomDragonEmoji() {
  const dragons = ['🐉', '🦕', '🦖', '🐲'];
  return dragons[Math.floor(Math.random() * dragons.length)];
}

// Decide where a monster steps next (chase the muncher 60% of the time,
// otherwise wander) and which way it should look while doing it.
function planEnemyMove(position, muncher) {
  const row = Math.floor(position / GRID_COLS);
  const col = position % GRID_COLS;

  let newRow = row;
  let newCol = col;

  if (Math.random() < 0.6) {
    const munRow = Math.floor(muncher / GRID_COLS);
    const munCol = muncher % GRID_COLS;

    if (row < munRow) newRow++;
    else if (row > munRow) newRow--;

    if (col < munCol) newCol++;
    else if (col > munCol) newCol--;
  } else {
    const dirs = [];
    if (row > 0) dirs.push('up');
    if (row < GRID_ROWS - 1) dirs.push('down');
    if (col > 0) dirs.push('left');
    if (col < GRID_COLS - 1) dirs.push('right');

    if (dirs.length > 0) {
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      if (dir === 'up') newRow--;
      else if (dir === 'down') newRow++;
      else if (dir === 'left') newCol--;
      else if (dir === 'right') newCol++;
    }
  }

  // Face the way it's stepping — prefer horizontal lean when moving diagonally.
  let facing = 'center';
  if (newCol < col) facing = 'left';
  else if (newCol > col) facing = 'right';
  else if (newRow < row) facing = 'up';
  else if (newRow > row) facing = 'down';

  const newPosition = newRow * GRID_COLS + newCol;
  return { newPosition, facing };
}
