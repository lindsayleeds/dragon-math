import { useState, useEffect, useCallback } from 'react';
import styles from '../styles/DragonMunchers.module.css';

const GRID_COLS = 6;
const GRID_ROWS = 6;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
const MOVE_INTERVAL = 200; // ms for muncher movement
const ENEMY_MOVE_INTERVAL = 3000; // ms for enemy movement
const SPAWN_INTERVAL = 4000; // ms for spawning new enemies

/**
 * DragonMunchers
 *
 * A dragon-themed game where the player controls a muncher and avoids enemy dragons.
 * The player has 3 lives and gains points for each second survived.
 *
 * @param {Object} props
 * @param {string} props.operation - Math operation: 'mul', 'div', 'add', 'sub'
 * @param {number} props.baseNumber - The base number (1-12) for all problems
 * @param {Function} props.onComplete - Callback when game ends
 */
export function DragonMunchers({ operation, baseNumber, onComplete }) {
  const [muncher, setMuncher] = useState(TOTAL_CELLS - 1); // Start at bottom right
  const [enemies, setEnemies] = useState([]); // Array of { id, position }
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [nextEnemyId, setNextEnemyId] = useState(0);

  // Generate grid numbers for the operation
  const gridNumbers = Array.from({ length: TOTAL_CELLS }, (_, i) => {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    return (row * GRID_COLS + col + 1) % 12 + 1; // Distribute 1-12
  });

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
      setEnemies(prev => [...prev, { id: nextEnemyId, position: newPosition }]);
    }, SPAWN_INTERVAL);

    return () => clearInterval(spawnTimer);
  }, [gameOver, nextEnemyId]);

  // Move enemies periodically and check collisions
  useEffect(() => {
    if (gameOver) return;

    const enemyTimer = setInterval(() => {
      setEnemies(prev => {
        const updated = prev.map(enemy => {
          const row = Math.floor(enemy.position / GRID_COLS);
          const col = enemy.position % GRID_COLS;

          let newRow = row;
          let newCol = col;

          // 60% chance to move toward muncher, 40% chance to move randomly
          if (Math.random() < 0.6) {
            // Move towards muncher
            const munRow = Math.floor(muncher / GRID_COLS);
            const munCol = muncher % GRID_COLS;

            if (row < munRow) newRow++;
            else if (row > munRow) newRow--;

            if (col < munCol) newCol++;
            else if (col > munCol) newCol--;
          } else {
            // Move randomly
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

          const newPosition = newRow * GRID_COLS + newCol;
          return { ...enemy, position: newPosition };
        });

        // Check collisions
        const collision = updated.some(enemy => enemy.position === muncher);
        if (collision) {
          setLives(l => {
            const newLives = l - 1;
            if (newLives <= 0) {
              setGameOver(true);
            }
            return newLives;
          });
          // Reset muncher position
          setMuncher(TOTAL_CELLS - 1);
          // Remove colliding enemy
          return updated.filter(enemy => enemy.position !== muncher);
        }

        return updated;
      });
    }, ENEMY_MOVE_INTERVAL);

    return () => clearInterval(enemyTimer);
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

  if (gameOver) {
    return (
      <div className={styles.container}>
        <div className={styles.gameOverScreen}>
          <div className={styles.gameOverIcon}>🐉</div>
          <h2 className={styles.gameOverTitle}>You've been caught!</h2>
          <div className={styles.gameOverScore}>You survived {score} seconds</div>
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
        <div className={styles.headerItem}>
          <span className={styles.label}>Score:</span>
          <span className={styles.value}>{score}</span>
        </div>
        <div className={styles.headerItem}>
          <span className={styles.label}>Lives:</span>
          <span className={styles.lives}>
            {Array.from({ length: lives }).map((_, i) => (
              <span key={i} className={styles.lifeIcon}>❤️</span>
            ))}
          </span>
        </div>
      </div>

      <div
        className={styles.gameArea}
        onTouchStart={handleTouchStart}
      >
        <div className={styles.grid}>
          {Array.from({ length: TOTAL_CELLS }).map((_, idx) => (
            <div key={idx} className={styles.cell}>
              <div className={styles.cellNumber}>{gridNumbers[idx]}</div>
              {muncher === idx && (
                <div className={styles.muncher}>🐉</div>
              )}
              {enemies.map(enemy =>
                enemy.position === idx ? (
                  <div key={enemy.id} className={styles.enemy}>🔥</div>
                ) : null
              )}
            </div>
          ))}
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
        Use arrow keys or touch to move. Avoid the dragons!
      </div>
    </div>
  );
}
