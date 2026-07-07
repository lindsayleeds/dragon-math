import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPERATIONS, OPERATION_BY_KEY } from '../data/operations';
import { GAME_TYPES } from '../data/games';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import styles from '../styles/LearningLair.module.css';

// The lair opens on a fork: practice a specific skill, or pick a game first.
//   'choose' — the two-card fork
//   'skill'  — pick an operation, then its mastery grid (existing flow)
//   'game'   — pick a game, then (if it has a choice) pick a skill for it
const MODE = { CHOOSE: 'choose', SKILL: 'skill', GAME: 'game' };

export function LearningLairPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(MODE.CHOOSE);
  // When a game is picked first, the skill we still need it to practice.
  const [gameNeedingSkill, setGameNeedingSkill] = useState(null);

  usePlaytimeHeartbeat(true);

  // Send the player into a skill's mastery grid. When `game` is set, the
  // operation page launches that game instead of opening the game chooser.
  const goToSkill = (opKey, game = null) => {
    navigate(`/learning-lair/${opKey}`, game ? { state: { game } } : undefined);
  };

  const pickGame = (game) => {
    if (game.route) {
      navigate(game.route); // self-contained game with its own page
    } else if (game.skills.length === 1) {
      goToSkill(game.skills[0], game.id); // only one skill — no need to ask
    } else {
      setGameNeedingSkill(game);
    }
  };

  const subtitle =
    mode === MODE.SKILL ? '— pick a skill to practice'
    : gameNeedingSkill ? `— which skill for ${gameNeedingSkill.name}?`
    : mode === MODE.GAME ? '— pick a game to play'
    : '— what would you like to do?';

  // On the skill/game screens, the back tab steps back to the fork rather than
  // all the way out to the map.
  const onBack = () => {
    if (gameNeedingSkill) {
      setGameNeedingSkill(null);
    } else if (mode !== MODE.CHOOSE) {
      setMode(MODE.CHOOSE);
    } else {
      navigate('/home');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={onBack}>
          {mode === MODE.CHOOSE ? '⌂ home' : '← back'}
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🦉</span>
          <h1 className={styles.title}>Learning Lair</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </header>

      <main className={styles.main}>
        {mode === MODE.CHOOSE && (
          <div className={styles.forkGrid}>
            <button
              type="button"
              className={styles.forkCard}
              style={{ '--accent': 'var(--sage)' }}
              onClick={() => setMode(MODE.SKILL)}
            >
              <span className={styles.forkIcon} aria-hidden>🎯</span>
              <span className={styles.forkLabel}>Choose a skill</span>
              <span className={styles.forkBlurb}>practice a kind of math</span>
            </button>
            <button
              type="button"
              className={styles.forkCard}
              style={{ '--accent': 'var(--sky)' }}
              onClick={() => setMode(MODE.GAME)}
            >
              <span className={styles.forkIcon} aria-hidden>🎮</span>
              <span className={styles.forkLabel}>Choose a game</span>
              <span className={styles.forkBlurb}>pick how you want to play</span>
            </button>
          </div>
        )}

        {mode === MODE.SKILL && (
          <div className={styles.cardGrid}>
            {OPERATIONS.map(op => (
              <button
                key={op.key}
                type="button"
                className={styles.opCard}
                style={{ '--accent': op.color }}
                onClick={() => goToSkill(op.key)}
                aria-label={`Practice ${op.label}`}
              >
                <span className={styles.opSymbol} aria-hidden>{op.symbol}</span>
                <span className={styles.opLabel}>{op.label}</span>
                <span className={styles.opBlurb}>{op.blurb}</span>
              </button>
            ))}
          </div>
        )}

        {mode === MODE.GAME && !gameNeedingSkill && (
          <div className={styles.gameCardGrid}>
            {GAME_TYPES.map(game => (
              <button
                key={game.id}
                type="button"
                className={styles.gameCard}
                onClick={() => pickGame(game)}
                aria-label={`Play ${game.name}`}
              >
                <span className={styles.gameEmoji} aria-hidden>{game.emoji}</span>
                <span className={styles.gameName}>{game.name}</span>
                <span className={styles.gameBlurb}>{game.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Game picked first, now choose which skill it should practice. */}
        {gameNeedingSkill && (
          <div className={styles.cardGrid}>
            {gameNeedingSkill.skills.map(key => {
              const op = OPERATION_BY_KEY[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.opCard}
                  style={{ '--accent': op.color }}
                  onClick={() => goToSkill(op.key, gameNeedingSkill.id)}
                  aria-label={`Play ${gameNeedingSkill.name} with ${op.label}`}
                >
                  <span className={styles.opSymbol} aria-hidden>{op.symbol}</span>
                  <span className={styles.opLabel}>{op.label}</span>
                  <span className={styles.opBlurb}>{op.blurb}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
