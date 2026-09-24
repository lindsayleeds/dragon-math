import { useState, useEffect, useCallback, useRef } from 'react';
import styles from '../styles/DragonMunchers.module.css';
import { api } from '../api';
import { soundEffects } from '../utils/soundEffects';
import { FatDragonAvatar } from './FatDragonAvatar';
import { DRAGON_VARIANTS } from '../data/dragonVariants';
import { MonsterMuncher } from './MonsterMuncher';
import {
  TOTAL_CELLS,
  createMunchersState,
  currentBase as currentBaseOf,
  isFrozen,
  nextTimerAt,
  stepMunchers,
  totalCorrect as totalCorrectOf,
} from '../rules/munchers';
import { munchersSettingsFromServer } from '../data/ruleSettings';
import { cachedRuleSettings } from '../hooks/useRuleSettings';

// Below this many pixels of travel a touch is a tap, not a swipe.
const SWIPE_THRESHOLD_PX = 30;

const HIGH_SCORE_KEY = 'dragonMunchers.highScore';
const DRAGON_VARIANT_KEY = 'dragonMunchers.dragon';
const LEADERBOARD_GAME = 'dragon-munchers';

const SOUNDS = {
  correct: () => soundEffects.playCorrect(),
  wrong: () => soundEffects.playWrong(),
  caught: () => soundEffects.playCaught(),
};
// Read through a wrapper, not captured, so a test spying on Math.random still
// reaches every draw.
const random = () => Math.random();
const now = () => Date.now();

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

function readHighScore() {
  const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? '', 10);
  return Number.isFinite(stored) ? stored : 0;
}

// The game's rules — board, levels, monsters, collisions, lives, scoring —
// live in the pure reducer in src/rules/munchers.js. This component renders
// its state, turns keys, swipes and taps into events, keeps one setTimeout
// armed for the reducer's next deadline, and performs what it asks for:
// sounds, the device high score, and the leaderboard.
export function DragonMunchers({ operation, baseNumber, progression = false, onComplete }) {
  // The tunables are fixed when the game is dealt: the served `munchers`
  // section of GET /api/rule-settings if it has loaded (main.jsx prefetches
  // it), else the identical fallbacks.
  const [initial] = useState(() => createMunchersState(
    {
      operation,
      baseNumber,
      progression,
      highScore: readHighScore(),
      settings: munchersSettingsFromServer(cachedRuleSettings()),
    },
    random,
  ));
  // `game` is what renders; `gameRef` is the same state, current even before
  // React re-renders, which is what the next event is stepped from.
  const [game, setGame] = useState(initial);
  const gameRef = useRef(initial);
  const clockRef = useRef(null);

  // All-time top scores, fetched from the server once the game ends.
  const [leaderboard, setLeaderboard] = useState(null);
  const leaderboardCancelledRef = useRef(false);
  // Where a touch began, so touchend can tell a swipe (move) from a tap (eat).
  const touchStartRef = useRef(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // When the game ends, record this run on the server and pull the all-time top
  // scores to show on the game-over screen. Best-effort: if the player is offline
  // or unauthenticated the leaderboard just stays hidden — the run still shows.
  const recordGame = useCallback(async (score) => {
    try {
      await api.post(`/api/leaderboard/${LEADERBOARD_GAME}`, { score });
    } catch {
      // Saving failed — still try to show the existing board below.
    }
    try {
      const { leaderboard: rows } = await api.get(`/api/leaderboard/${LEADERBOARD_GAME}?limit=5`);
      if (!leaderboardCancelledRef.current) setLeaderboard(rows);
    } catch {
      if (!leaderboardCancelledRef.current) setLeaderboard([]);
    }
  }, []);

  const dispatch = useCallback(function dispatch(event) {
    const { state, effects } = stepMunchers(gameRef.current, event, random);
    gameRef.current = state;
    setGame(state);
    for (const effect of effects) {
      if (effect.type === 'sound') SOUNDS[effect.sound]?.();
      else if (effect.type === 'saveHighScore') {
        try {
          localStorage.setItem(HIGH_SCORE_KEY, String(effect.score));
        } catch {
          // Ignore storage failures (private mode, quota) — the run still shows.
        }
      } else if (effect.type === 'gameOver') recordGame(effect.score);
    }
    // Re-arm here rather than in an effect, so a deadline reached while React
    // has not re-rendered yet still fires on time.
    if (clockRef.current) clearTimeout(clockRef.current);
    clockRef.current = null;
    const at = nextTimerAt(state);
    if (at !== null) {
      clockRef.current = setTimeout(() => {
        clockRef.current = null;
        dispatch({ type: 'tick', now: now() });
      }, Math.max(0, Math.ceil(at - now())));
    }
  }, [recordGame]);

  // Drop the pending deadline and any leaderboard fetch on unmount.
  useEffect(() => {
    leaderboardCancelledRef.current = false;
    return () => {
      leaderboardCancelledRef.current = true;
      if (clockRef.current) clearTimeout(clockRef.current);
      clockRef.current = null;
    };
  }, []);

  // New props re-plan the levels and re-deal the board as needed; the reducer
  // ignores props that did not change (including on mount).
  useEffect(() => {
    dispatch({ type: 'configChanged', now: now(), operation, baseNumber, progression });
  }, [operation, baseNumber, progression, dispatch]);

  // Which dragon the player picked, and whether they've started. The board sits
  // frozen on the dragon-picker screen until they hit "Let's go!". The last
  // choice is remembered on this device and pre-selected next time.
  const [dragonVariant, setDragonVariant] = useState(() => {
    const stored = localStorage.getItem(DRAGON_VARIANT_KEY);
    return DRAGON_VARIANTS.some(d => d.id === stored) ? stored : DRAGON_VARIANTS[0].id;
  });

  const startGame = useCallback(() => {
    try {
      localStorage.setItem(DRAGON_VARIANT_KEY, dragonVariant);
    } catch {
      // Ignore storage failures (private mode, quota) — the choice still applies.
    }
    dispatch({ type: 'start', now: now() });
  }, [dragonVariant, dispatch]);

  const frozen = isFrozen(game);
  const {
    started,
    gameOver,
    levelTransition,
    caughtAt,
    level,
    levels,
    lives,
    score,
    highScore,
    isNewHighScore,
    babyDragons,
    enemies,
    muncher,
    wrongAnswer,
  } = game;
  const currentBase = currentBaseOf(game);
  const gridNumbers = game.board;
  const totalCorrect = totalCorrectOf(game);
  const correctAnswersEaten = game.correctEaten;
  const eatenPositions = game.eaten;
  const wrongAnswerMsg = wrongAnswer
    ? getWrongAnswerMessage(wrongAnswer.operation, wrongAnswer.baseNumber, wrongAnswer.value)
    : null;

  const moveMuncher = useCallback((direction) => {
    dispatch({ type: 'move', now: now(), direction });
  }, [dispatch]);

  const advanceLevel = useCallback(() => {
    dispatch({ type: 'advanceLevel', now: now() });
  }, [dispatch]);

  const dismissWrongAnswer = useCallback(() => {
    dispatch({ type: 'dismissWrongAnswer', now: now() });
  }, [dispatch]);

  // Keyboard: arrows/WASD move, space eats. Nothing is listened for while play
  // is frozen.
  useEffect(() => {
    if (frozen) return;

    const handleKeyDown = (e) => {
      const direction = {
        ArrowUp: 'up', w: 'up',
        ArrowDown: 'down', s: 'down',
        ArrowLeft: 'left', a: 'left',
        ArrowRight: 'right', d: 'right',
      }[e.key];
      if (direction) {
        e.preventDefault();
        moveMuncher(direction);
      } else if (e.code === 'Space') {
        e.preventDefault();
        dispatch({ type: 'eat', now: now() });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [frozen, moveMuncher, dispatch]);

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
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_THRESHOLD_PX) return;

    // It's a swipe: suppress the synthesized click so the cell's onClick
    // doesn't fire a second move on top of this one.
    e.preventDefault();

    if (Math.abs(dx) > Math.abs(dy)) {
      moveMuncher(dx > 0 ? 'right' : 'left');
    } else {
      moveMuncher(dy > 0 ? 'down' : 'up');
    }
  }, [frozen, moveMuncher]);

  // The on-screen arrows move the muncher even while play is frozen, as they
  // always have (see "Frozen" in src/rules/munchers.js).
  const handleButtonClick = moveMuncher;

  // A tap on the muncher's own cell eats; on a neighbouring cell, steps there.
  const handleCellClick = useCallback((cellIndex) => {
    dispatch({ type: 'tapCell', now: now(), cell: cellIndex });
  }, [dispatch]);

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
            const value = gridNumbers[idx];
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
                {!eatenPositions.includes(idx) && !hasEnemy && (
                  <div className={styles.cellNumber}>{value}</div>
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
              onClick={dismissWrongAnswer}
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
