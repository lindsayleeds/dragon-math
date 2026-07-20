import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styles from '../styles/DragonMunchers.module.css';
import { api } from '../api';
import { soundEffects } from '../utils/soundEffects';
import { FatDragonAvatar, DRAGON_VARIANTS } from './FatDragonAvatar';
import { MonsterMuncher } from './MonsterMuncher';

const GRID_COLS = 5;
const GRID_ROWS = 6;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
// Times tables run up to ×12, so each game covers the full 1..12 table.
const MAX_FACTOR = 12;
const MOVE_INTERVAL = 200;
const ENEMY_MOVE_INTERVAL = 3000;
// How long the monster "looks" toward its next cell before it actually moves.
const ENEMY_TELEGRAPH = 750;
const SPAWN_INTERVAL = 4000;

// Progression campaign: warm up on the smaller numbers (2–5) in a random order,
// then step up to the trickier ones (6–9). Each base number is one "level".
const PROGRESSION_EASY = [2, 3, 4, 5];
const PROGRESSION_HARD = [6, 7, 8, 9];
const MAX_ENEMIES = 3;
const MIN_ENEMY_INTERVAL = 1100; // monsters never move faster than this

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getCorrectAnswers(operation, baseNumber) {
  const raw = [];
  for (let i = 1; i <= MAX_FACTOR; i++) {
    if (operation === 'mul') raw.push(baseNumber * i);
    else if (operation === 'add') raw.push(baseNumber + i);
    else if (operation === 'sub') raw.push(baseNumber - i);
    else if (operation === 'div') raw.push(Math.floor(baseNumber / i));
  }
  // Keep only positive whole answers, with no duplicates.
  return [...new Set(raw.filter(v => v >= 1))];
}

// Largest number allowed to appear on the grid, so distractors stay in range
// with the answers (e.g. multiples of 3 → nothing bigger than 12 × 3 = 36).
function getMaxValue(operation, baseNumber) {
  switch (operation) {
    case 'mul':
      return baseNumber * MAX_FACTOR;
    case 'add':
      return baseNumber + MAX_FACTOR;
    case 'sub':
    case 'div':
      return baseNumber;
    default:
      return 100;
  }
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

// Points per correct answer: the easy levels (multiples of 2–5) are worth 5,
// the harder ones (6 and up) are worth 10.
const HIGH_SCORE_KEY = 'dragonMunchers.highScore';
const DRAGON_VARIANT_KEY = 'dragonMunchers.dragon';
const LEADERBOARD_GAME = 'dragon-munchers';
function pointsForBase(baseNumber) {
  return baseNumber <= 5 ? 5 : 10;
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

export function DragonMunchers({ operation, baseNumber, progression = false, onComplete }) {
  // In progression mode we march through a shuffled sequence of base numbers;
  // otherwise it's a single round on the given baseNumber.
  const levels = useMemo(
    () => (progression ? [...shuffle(PROGRESSION_EASY), ...shuffle(PROGRESSION_HARD)] : [baseNumber]),
    [progression, baseNumber]
  );
  const [level, setLevel] = useState(0);
  const currentBase = levels[level] ?? baseNumber;

  // Difficulty scales with progress: the monster speeds up every level, and a
  // new monster joins after every 3 cleared levels (capped at MAX_ENEMIES).
  const maxEnemies = progression ? Math.min(MAX_ENEMIES, 1 + Math.floor(level / 3)) : 1;
  const enemyInterval = progression
    ? Math.max(MIN_ENEMY_INTERVAL, ENEMY_MOVE_INTERVAL - level * 220)
    : ENEMY_MOVE_INTERVAL;

  const [muncher, setMuncher] = useState(TOTAL_CELLS - 1);
  const [enemies, setEnemies] = useState([]);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? '', 10);
    return Number.isFinite(stored) ? stored : 0;
  });
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  // All-time top scores, fetched from the server once the game ends.
  const [leaderboard, setLeaderboard] = useState(null);
  // Between-level breather: freezes play while the "level up" splash shows.
  const [levelTransition, setLevelTransition] = useState(false);
  const enemyIdRef = useRef(0);
  // Latest player position, readable inside timers without resetting them.
  const muncherRef = useRef(muncher);
  muncherRef.current = muncher;
  // Where a touch began, so touchend can tell a swipe (move) from a tap (eat).
  const touchStartRef = useRef(null);
  const [correctAnswersEaten, setCorrectAnswersEaten] = useState(0);
  const [babyDragons, setBabyDragons] = useState([]);
  const [eatenPositions, setEatenPositions] = useState(new Set());
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [wrongAnswerMsg, setWrongAnswerMsg] = useState(null);
  // Cell where a monster just caught the muncher — drives the "gobbled" beat.
  const [caughtAt, setCaughtAt] = useState(null);

  // Which dragon the player picked, and whether they've started. The board sits
  // frozen on the dragon-picker screen until they hit "Let's go!". The last
  // choice is remembered on this device and pre-selected next time.
  const [dragonVariant, setDragonVariant] = useState(() => {
    const stored = localStorage.getItem(DRAGON_VARIANT_KEY);
    return DRAGON_VARIANTS.some(d => d.id === stored) ? stored : DRAGON_VARIANTS[0].id;
  });
  const [started, setStarted] = useState(false);

  const startGame = useCallback(() => {
    try {
      localStorage.setItem(DRAGON_VARIANT_KEY, dragonVariant);
    } catch {
      // Ignore storage failures (private mode, quota) — the choice still applies.
    }
    setStarted(true);
  }, [dragonVariant]);

  // Play is frozen on the picker screen, during the game-over screen, the
  // between-level splash, and the brief catch animation while the muncher is
  // being gobbled.
  const frozen = !started || gameOver || levelTransition || caughtAt !== null;

  const gridNumbers = useMemo(() => {
    const correctAnswers = getCorrectAnswers(operation, currentBase);
    const maxValue = getMaxValue(operation, currentBase);
    const grid = Array(TOTAL_CELLS).fill(null);

    const positions = Array.from({ length: TOTAL_CELLS }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Place every correct answer.
    const correctSet = new Set(correctAnswers);
    const numCorrect = Math.min(correctAnswers.length, TOTAL_CELLS);
    for (let i = 0; i < numCorrect; i++) {
      grid[positions[i]] = { value: correctAnswers[i], isCorrect: true };
    }

    // Distractors come only from in-range numbers that are NOT valid answers,
    // so a real multiple can never be shown as "wrong".
    const distractorPool = [];
    for (let v = 1; v <= maxValue; v++) {
      if (!correctSet.has(v)) distractorPool.push(v);
    }

    for (let i = numCorrect; i < TOTAL_CELLS; i++) {
      if (distractorPool.length === 0) break; // nothing valid to show (e.g. ×1)
      const value = distractorPool[Math.floor(Math.random() * distractorPool.length)];
      grid[positions[i]] = { value, isCorrect: false };
    }

    return grid;
  }, [operation, currentBase]);

  // How many correct cells are actually on the board — the win target.
  const totalCorrect = useMemo(
    () => gridNumbers.filter(cell => cell?.isCorrect).length,
    [gridNumbers]
  );

  // Reset the board for the next base number, keeping lives and score.
  const advanceLevel = useCallback(() => {
    setLevel(l => l + 1);
    setMuncher(TOTAL_CELLS - 1);
    muncherRef.current = TOTAL_CELLS - 1;
    setEnemies([]);
    setEatenPositions(new Set());
    setCorrectAnswersEaten(0);
    setBabyDragons([]);
    setWrongAnswerMsg(null);
    setLevelTransition(false);
  }, []);

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
    if (frozen) return;

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
  }, [frozen, moveMuncher]);

  // Handle touch controls for mobile
  // Track where a touch starts; the direction is decided on touchend by the
  // swipe delta. A tap (small delta) falls through to the cell's onClick so the
  // dragon can eat the number it's standing on.
  const handleTouchStart = useCallback((e) => {
    if (frozen) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, [frozen]);

  const handleTouchEnd = useCallback((e) => {
    if (frozen) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Below this threshold it's a tap, not a swipe — let onClick handle it.
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;

    // It's a swipe: suppress the synthesized click so the cell's onClick
    // doesn't fire a second move on top of this one.
    e.preventDefault();

    if (Math.abs(dx) > Math.abs(dy)) {
      moveMuncher(dx > 0 ? 'right' : 'left');
    } else {
      moveMuncher(dy > 0 ? 'down' : 'up');
    }
  }, [frozen, moveMuncher]);

  // Keep the board stocked with up to `maxEnemies`. Whenever there's room (start,
  // after one caught the player, or after a difficulty bump adds a slot), spawn a
  // fresh one a safe distance away — never on top of or right next to the player.
  useEffect(() => {
    if (frozen) return;

    const spawnTimer = setInterval(() => {
      setEnemies(prev => {
        if (prev.length >= maxEnemies) return prev;
        const occupied = new Set(prev.map(e => e.position));
        const position = pickSpawnPosition(muncherRef.current, occupied);
        if (position == null) return prev; // no safe, unoccupied cell — skip this tick
        return [...prev, { id: enemyIdRef.current++, position, facing: 'center' }];
      });
    }, SPAWN_INTERVAL);

    return () => clearInterval(spawnTimer);
  }, [frozen, maxEnemies]);

  const eatNumber = useCallback(() => {
    if (eatenPositions.has(muncher)) return;

    const cellData = gridNumbers[muncher];
    if (cellData?.value == null) return;

    setEatenPositions(prev => new Set([...prev, muncher]));

    if (cellData.isCorrect) {
      soundEffects.playCorrect();
      setScore(s => s + pointsForBase(currentBase));
      const newCount = correctAnswersEaten + 1;
      setCorrectAnswersEaten(newCount);

      setBabyDragons(prev => [...prev, { id: `${level}-${newCount}`, emoji: getRandomDragonEmoji() }]);

      // Cleared the board: either on to the next level, or that's the game.
      if (newCount === totalCorrect) {
        if (progression && level < levels.length - 1) {
          setLevelTransition(true);
        } else {
          setGameOver(true);
        }
      }
    } else {
      // Wrong answer - show message
      soundEffects.playWrong();
      setWrongAnswerMsg(getWrongAnswerMessage(operation, currentBase, cellData.value));
    }
  }, [muncher, gridNumbers, totalCorrect, correctAnswersEaten, eatenPositions, operation, currentBase, progression, level, levels.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (frozen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        eatNumber();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [eatNumber, frozen]);

  // Move enemies periodically and check collisions.
  // Each cycle has two beats: first the monster turns to look at the cell it's
  // about to move into (the telegraph), then after a short pause it actually
  // moves and we check for collisions.
  useEffect(() => {
    if (frozen) return;

    let commitTimer;

    const enemyTimer = setInterval(() => {
      // Beat 1 — plan each monster's next step and turn it to face that way.
      // Read the live player position from the ref so this interval stays
      // stable; depending on `muncher` directly would restart the timer on
      // every move and the monsters would never get a tick.
      setEnemies(prev => {
        // Plan every monster's desired step, then settle conflicts so no two
        // monsters claim the same cell. `finals` starts with everyone holding
        // their current cell; a monster only takes its target if no other
        // monster's settled position already occupies it. Resolving in order
        // means a later monster sees earlier monsters' committed cells, so two
        // can swap places but never stack — and a monster won't step onto one
        // that's staying put.
        const plans = prev.map(enemy => planEnemyMove(enemy.position, muncherRef.current));
        const finals = prev.map(enemy => enemy.position);
        for (let i = 0; i < prev.length; i++) {
          const target = plans[i].newPosition;
          const blocked = finals.some((pos, j) => j !== i && pos === target);
          if (!blocked) finals[i] = target;
        }
        return prev.map((enemy, i) => {
          const moved = finals[i] !== enemy.position;
          return {
            ...enemy,
            facing: moved ? plans[i].facing : 'center',
            nextPosition: finals[i],
          };
        });
      });

      // Beat 2 — after the telegraph, commit the move and check collisions.
      commitTimer = setTimeout(() => {
        setEnemies(prev => {
          const updated = prev.map(enemy => ({
            ...enemy,
            position: enemy.nextPosition ?? enemy.position,
            facing: 'center', // settle back to looking dead-on between moves
          }));

          const playerPos = muncherRef.current;
          const collision = updated.some(enemy => enemy.position === playerPos);
          if (collision) {
            // Start the "gobbled" beat: the sad trombone plays and `frozen`
            // pauses everything while the muncher animates away. The lives hit,
            // muncher reset, and enemy cleanup happen once the beat finishes
            // (see the caughtAt effect below). Keep the monster on its cell so
            // it can chomp on top of the shrinking muncher.
            soundEffects.playCaught();
            setCaughtAt(playerPos);
          }

          return updated;
        });
      }, ENEMY_TELEGRAPH);
    }, enemyInterval);

    return () => {
      clearInterval(enemyTimer);
      clearTimeout(commitTimer);
    };
  }, [frozen, enemyInterval]);

  // If the player walks onto a monster, that counts as being caught too — the
  // enemy timer only checks collisions when a monster moves, so without this a
  // player could step right onto a stationary monster unscathed.
  useEffect(() => {
    if (frozen) return;
    if (enemies.some(enemy => enemy.position === muncher)) {
      soundEffects.playCaught();
      setCaughtAt(muncher);
    }
  }, [muncher, enemies, frozen]);

  // After the muncher is caught, let the gobble animation and sad trombone
  // play for a beat, then dock a life, send the muncher back to the start, and
  // clear away the monster that got it.
  useEffect(() => {
    if (caughtAt == null) return;

    const timer = setTimeout(() => {
      setLives(l => {
        const newLives = l - 1;
        if (newLives <= 0) {
          setGameOver(true);
        }
        return newLives;
      });
      setMuncher(TOTAL_CELLS - 1);
      muncherRef.current = TOTAL_CELLS - 1;
      setEnemies(prev => prev.filter(enemy => enemy.position !== caughtAt));
      setCaughtAt(null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [caughtAt]);

  // Once the game ends, bank a new personal best (kept on this device).
  useEffect(() => {
    if (!gameOver) return;
    if (score > highScore) {
      setIsNewHighScore(true);
      setHighScore(score);
      try {
        localStorage.setItem(HIGH_SCORE_KEY, String(score));
      } catch {
        // Ignore storage failures (private mode, quota) — the run still shows.
      }
    }
    // Runs when the game ends; score/highScore are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  // When the game ends, record this run on the server and pull the all-time top
  // scores to show on the game-over screen. Best-effort: if the player is offline
  // or unauthenticated the leaderboard just stays hidden — the run still shows.
  useEffect(() => {
    if (!gameOver) return;
    let cancelled = false;
    (async () => {
      try {
        await api.post(`/api/leaderboard/${LEADERBOARD_GAME}`, { score });
      } catch {
        // Saving failed — still try to show the existing board below.
      }
      try {
        const { leaderboard: rows } = await api.get(`/api/leaderboard/${LEADERBOARD_GAME}?limit=5`);
        if (!cancelled) setLeaderboard(rows);
      } catch {
        if (!cancelled) setLeaderboard([]);
      }
    })();
    return () => { cancelled = true; };
    // Runs once when the game ends; score is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  // Handle button clicks for mobile
  const handleButtonClick = useCallback((direction) => {
    moveMuncher(direction);
  }, [moveMuncher]);

  // Handle cell clicks for mobile movement
  const handleCellClick = useCallback((cellIndex) => {
    if (frozen) return;

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
  }, [muncher, frozen, eatNumber, moveMuncher]);

  if (!started) {
    return (
      <div className={styles.container}>
        <div className={styles.chooseScreen}>
          <h2 className={styles.chooseTitle}>Pick your dragon!</h2>
          <p className={styles.chooseSubtitle}>
            Choose a buddy to munch the right answers.
          </p>
          <div className={styles.dragonChoices}>
            {DRAGON_VARIANTS.map(d => (
              <button
                key={d.id}
                type="button"
                className={`${styles.dragonChoice} ${dragonVariant === d.id ? styles.dragonChoiceSelected : ''}`}
                onClick={() => setDragonVariant(d.id)}
                aria-pressed={dragonVariant === d.id}
                aria-label={`Choose ${d.name} the dragon`}
              >
                <div className={styles.choiceAvatar}>
                  <FatDragonAvatar size="fill" variant={d.id} />
                </div>
                <span className={styles.dragonChoiceName}>{d.name}</span>
              </button>
            ))}
          </div>
          <button className={styles.startButton} onClick={startGame}>
            Let's go! →
          </button>
          <button className={styles.chooseBack} onClick={() => onComplete?.()}>
            ← Back to the Lair
          </button>
        </div>
      </div>
    );
  }

  if (gameOver) {
    const won = correctAnswersEaten === totalCorrect;
    // Blaze gets a celebratory "eats the number" clip when the round is won.
    const showBlazeVideo = won && dragonVariant === 'blaze';
    return (
      <div className={styles.container}>
        <div className={styles.gameOverScreen}>
          {showBlazeVideo ? (
            <BlazeWinVideo />
          ) : (
            <div className={styles.gameOverIcon}>{won ? '🎉' : '🐉'}</div>
          )}
          <h2 className={styles.gameOverTitle}>
            {won
              ? progression ? 'You cleared every level!' : 'You won the round!'
              : "You've been caught!"}
          </h2>
          <div className={styles.scoreBoard}>
            <div className={styles.scoreBig}>🏆 {score} points</div>
            {isNewHighScore ? (
              <div className={styles.newHighScore}>✨ New high score! ✨</div>
            ) : (
              <div className={styles.bestScore}>Best: {highScore} points</div>
            )}
          </div>

          {leaderboard && leaderboard.length > 0 && (
            <div className={styles.leaderboard}>
              <div className={styles.leaderboardTitle}>🏆 All-Time Top 5</div>
              <ol className={styles.leaderboardList}>
                {leaderboard.map((row, i) => (
                  <li key={`${row.username}-${i}`} className={styles.leaderboardRow}>
                    <span className={styles.leaderboardRank}>
                      {['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}
                    </span>
                    <span className={styles.leaderboardName}>{row.username}</span>
                    <span className={styles.leaderboardScore}>{row.score}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

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
          <span className={styles.label}>Lives:</span>
          <span className={styles.lives}>
            {Array.from({ length: lives }).map((_, i) => (
              <span key={i} className={styles.lifeIcon}>❤️</span>
            ))}
          </span>
        </div>
        <div className={styles.headerItem}>
          <span className={styles.label}>Score:</span>
          <span className={styles.value}>{score}</span>
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
        {progression && (
          <span className={styles.levelTag}>Level {level + 1}/{levels.length} · </span>
        )}
        {getGameTitle(operation, currentBase)}
      </div>

      <div className={styles.collection}>
        <span className={styles.collectionLabel}>
          {correctAnswersEaten}/{totalCorrect}
        </span>
        <div className={styles.dragonGrid}>
          {babyDragons.map(dragon => (
            <div key={dragon.id} className={styles.dragonSlot}>
              {dragon.emoji}
            </div>
          ))}
          {Array.from({ length: Math.max(0, totalCorrect - babyDragons.length) }).map((_, idx) => (
            <div key={`empty-${idx}`} className={styles.emptySlot} />
          ))}
        </div>
      </div>

      <div
        className={styles.gameArea}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
                  <div className={`${styles.muncher} ${caughtAt === idx ? styles.muncherCaught : ''}`}>
                    <FatDragonAvatar size="fill" variant={dragonVariant} />
                  </div>
                )}
                {caughtAt === idx && <div className={styles.chompBurst}>💥</div>}
                {enemies.map(enemy =>
                  enemy.position === idx ? (
                    <div
                      key={enemy.id}
                      className={`${styles.enemy} ${caughtAt === idx ? styles.enemyChomp : ''}`}
                    >
                      <MonsterMuncher facing={enemy.facing} size="fill" />
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
        <span className={styles.instructionsDesktop}>
          Use the arrow keys to move. Press spacebar to eat the number you're on. Avoid the monsters!
        </span>
        <span className={styles.instructionsMobile}>
          Tap a nearby square to move there. Tap the square you're already on to eat its number. Avoid the monsters!
        </span>
      </div>

      {/* Between-level splash */}
      {levelTransition && (
        <div className={styles.wrongAnswerModal}>
          <div className={styles.wrongAnswerContent}>
            {dragonVariant === 'blaze' && <BlazeWinVideo />}
            <p className={styles.wrongAnswerMsg}>
              🎉 Level {level + 1} cleared! Next: {getGameTitle(operation, levels[level + 1])}
            </p>
            <button
              className={styles.continueBtn}
              onClick={advanceLevel}
            >
              Keep going →
            </button>
          </div>
        </div>
      )}

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

// Blaze's celebratory clip. Tries to play with sound right away (works on
// desktop); if the browser blocks audio autoplay — as phones do without a
// gesture — it shows a "Tap to play" button that starts it with sound.
function BlazeWinVideo() {
  const videoRef = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const attempt = v.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => setNeedsTap(true));
    }
  }, []);

  const playWithSound = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    const attempt = v.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => setNeedsTap(false)).catch(() => {});
    } else {
      setNeedsTap(false);
    }
  }, []);

  return (
    <div className={styles.winVideoWrap}>
      <video
        ref={videoRef}
        className={styles.winVideo}
        src="/blaze_eats_number.mp4"
        playsInline
        onClick={playWithSound}
      />
      {needsTap && (
        <button type="button" className={styles.winVideoTap} onClick={playWithSound}>
          ▶ Tap to play
        </button>
      )}
    </div>
  );
}

function getRandomDragonEmoji() {
  const dragons = ['🐉', '🦕', '🦖', '🐲'];
  return dragons[Math.floor(Math.random() * dragons.length)];
}

// Pick a random cell for a new enemy that isn't on the player or any of the
// eight cells touching the player (Chebyshev distance > 1).
function pickSpawnPosition(muncher, occupied = new Set()) {
  const munRow = Math.floor(muncher / GRID_COLS);
  const munCol = muncher % GRID_COLS;

  const candidates = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (occupied.has(i)) continue; // never spawn on top of another monster
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    if (Math.max(Math.abs(row - munRow), Math.abs(col - munCol)) > 1) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
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
