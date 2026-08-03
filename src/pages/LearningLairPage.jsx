import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPERATION_BY_KEY } from '../data/operations';
import {
  GAME_TYPES,
  SKILL_TAG_BY_KEY,
  practisedSkillTags,
  isGameLocked,
} from '../data/games';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/LearningLair.module.css';

// The lair opens straight onto every game, each card showing which skills it
// tests, with a filter row to narrow the list to one skill. There is no
// skill-first fork: the mastery grid is still where a multi-skill game asks
// which facts to practice, so it's reached through a game rather than beside it.
const ALL = 'all';

export function LearningLairPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const plan = user?.effective_plan || user?.plan || 'free';
  const [skillFilter, setSkillFilter] = useState(ALL);
  // A game that supports several skills and needs the player to pick one.
  const [gameNeedingSkill, setGameNeedingSkill] = useState(null);
  // A locked game the kid tapped — shows a friendly "ask a grown-up" note.
  const [lockedGame, setLockedGame] = useState(null);

  usePlaytimeHeartbeat(true);

  const filters = practisedSkillTags();
  const games = skillFilter === ALL
    ? GAME_TYPES
    : GAME_TYPES.filter(g => g.practices.includes(skillFilter));

  // Send the player into a skill's mastery grid. When `game` is set, the
  // operation page launches that game instead of opening the game chooser.
  const goToSkill = (opKey, game = null) => {
    navigate(`/learning-lair/${opKey}`, game ? { state: { game } } : undefined);
  };

  const pickGame = (game) => {
    if (isGameLocked(game.id, plan)) {
      setLockedGame(game);
      return;
    }
    if (game.route) {
      navigate(game.route); // self-contained game with its own page
    } else if (game.skills.includes(skillFilter)) {
      // The filter already says which skill they want — don't ask again.
      goToSkill(skillFilter, game.id);
    } else if (game.skills.length === 1) {
      goToSkill(game.skills[0], game.id); // only one skill — no need to ask
    } else {
      setGameNeedingSkill(game);
    }
  };

  const subtitle = gameNeedingSkill
    ? `— which skill for ${gameNeedingSkill.name}?`
    : '— pick a game to play';

  // On the skill-pick step the back tab returns to the game list rather than
  // going all the way out to the map.
  const onBack = () => {
    if (gameNeedingSkill) {
      setGameNeedingSkill(null);
    } else {
      navigate('/home');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={onBack}>
          {gameNeedingSkill ? '← back' : '⌂ home'}
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🦉</span>
          <h1 className={styles.title}>Learning Lair</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </header>

      <main className={styles.main}>
        {!gameNeedingSkill && (
          <>
            <div className={styles.filterRow} role="group" aria-label="Filter games by skill">
              <button
                type="button"
                className={`${styles.filterChip} ${skillFilter === ALL ? styles.filterChipOn : ''}`}
                style={{ '--accent': 'var(--kraft)' }}
                aria-pressed={skillFilter === ALL}
                onClick={() => setSkillFilter(ALL)}
              >
                all games
              </button>
              {filters.map(tag => (
                <button
                  key={tag.key}
                  type="button"
                  className={`${styles.filterChip} ${skillFilter === tag.key ? styles.filterChipOn : ''}`}
                  style={{ '--accent': tag.color }}
                  aria-pressed={skillFilter === tag.key}
                  onClick={() => setSkillFilter(tag.key)}
                >
                  <span className={styles.filterChipSymbol} aria-hidden>{tag.symbol}</span>
                  {tag.label}
                </button>
              ))}
            </div>

            <div className={styles.gameCardGrid}>
              {games.map(game => {
                const locked = isGameLocked(game.id, plan);
                return (
                  <button
                    key={game.id}
                    type="button"
                    className={`${styles.gameCard} ${locked ? styles.gameCardLocked : ''}`}
                    onClick={() => pickGame(game)}
                    aria-label={locked ? `${game.name} (locked)` : `Play ${game.name}`}
                  >
                    {locked && <span className={styles.lockBadge} aria-hidden>🔒</span>}
                    <span className={styles.gameEmoji} aria-hidden>{game.emoji}</span>
                    <span className={styles.gameBody}>
                      <span className={styles.gameName}>{game.name}</span>
                      <span className={styles.gameBlurb}>{game.description}</span>
                      <span className={styles.skillTagRow}>
                        {game.practices.map(key => {
                          const tag = SKILL_TAG_BY_KEY[key];
                          return (
                            <span
                              key={key}
                              className={styles.skillTag}
                              style={{ '--accent': tag.color }}
                            >
                              <span aria-hidden>{tag.symbol}</span> {tag.label}
                            </span>
                          );
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* A multi-skill game was picked — choose which skill it practices. */}
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

      {lockedGame && (
        <div className={styles.lockOverlay} onClick={() => setLockedGame(null)}>
          <div className={styles.lockModal} onClick={e => e.stopPropagation()}>
            <span className={styles.lockModalIcon} aria-hidden>🔒</span>
            <h2 className={styles.lockModalTitle}>{lockedGame.name} is locked</h2>
            <p className={styles.lockModalText}>
              Ask a grown-up to unlock this game with a Premium plan. There are lots of other
              games to play in the meantime!
            </p>
            <button className={styles.lockModalBtn} onClick={() => setLockedGame(null)}>
              Okay!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
