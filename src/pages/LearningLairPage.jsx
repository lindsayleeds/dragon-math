import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPERATION_BY_KEY } from '../data/operations';
import {
  SKILL_TAG_BY_KEY,
  SUBJECT_BY_KEY,
  stockedSubjects,
  gamesForSubject,
  isGameLocked,
} from '../data/games';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useAuthContext } from '../contexts/AuthContext';
import styles from '../styles/LearningLair.module.css';

// The lair is a three-step funnel: SUBJECT → game → (for a multi-skill math
// game) which facts to practice.
//
// It used to open straight onto every game with a skill-filter chip row, which
// worked while the lair was four math games with one literacy game tacked on.
// It stopped working once the literacy side grew into whole programs of its own:
// a flat list makes Dragon Phonics look like one more mini-game rather than the
// eight-stage curriculum it is, and it puts a child hunting for spelling past
// four math cards. Subjects are also what a grown-up says out loud ("go do your
// phonics"), which is the instruction the child is usually acting on.
//
// The skill filter survives INSIDE a subject, where it still earns its place:
// Math has several games per operation. A subject with one game does not render
// it — one chip filtering one card is noise.

export function LearningLairPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const plan = user?.effective_plan || user?.plan || 'free';

  const [subject, setSubject] = useState(null);
  const [skillFilter, setSkillFilter] = useState(null);
  // A game that supports several skills and needs the player to pick one.
  const [gameNeedingSkill, setGameNeedingSkill] = useState(null);
  // A locked game the kid tapped — shows a friendly "ask a grown-up" note.
  const [lockedGame, setLockedGame] = useState(null);

  usePlaytimeHeartbeat(true);

  const subjects = stockedSubjects();
  const subjectGames = subject ? gamesForSubject(subject) : [];

  // Chips for the tags THIS subject's games actually practice, and only when
  // more than one game is on offer.
  const filterTags = subjectGames.length > 1
    ? [...new Set(subjectGames.flatMap(g => g.practices))]
      .map(key => SKILL_TAG_BY_KEY[key])
      .filter(Boolean)
    : [];
  const games = skillFilter
    ? subjectGames.filter(g => g.practices.includes(skillFilter))
    : subjectGames;

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
    } else if (skillFilter && game.skills.includes(skillFilter)) {
      // The filter already says which skill they want — don't ask again.
      goToSkill(skillFilter, game.id);
    } else if (game.skills.length === 1) {
      goToSkill(game.skills[0], game.id); // only one skill — no need to ask
    } else {
      setGameNeedingSkill(game);
    }
  };

  const subjectInfo = subject ? SUBJECT_BY_KEY[subject] : null;

  const subtitle = gameNeedingSkill
    ? `— which skill for ${gameNeedingSkill.name}?`
    : subjectInfo
      ? `— ${subjectInfo.label.toLowerCase()}: pick a game`
      : '— what shall we work on?';

  // Back unwinds one step of the funnel at a time rather than jumping home.
  const onBack = () => {
    if (gameNeedingSkill) setGameNeedingSkill(null);
    else if (subject) {
      setSubject(null);
      setSkillFilter(null);
    } else navigate('/home');
  };

  const atRoot = !subject && !gameNeedingSkill;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={onBack}>
          {atRoot ? '⌂ home' : '← back'}
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🦉</span>
          <h1 className={styles.title}>Learning Lair</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </header>

      <main className={styles.main}>
        {/* Step 1 — subject */}
        {atRoot && (
          <div className={styles.subjectGrid}>
            {subjects.map(s => (
              <button
                key={s.key}
                type="button"
                className={styles.subjectCard}
                style={{ '--accent': s.color }}
                onClick={() => {
                  setSubject(s.key);
                  setSkillFilter(null);
                }}
                aria-label={`${s.label} games`}
              >
                <span className={styles.subjectEmoji} aria-hidden>{s.emoji}</span>
                <span className={styles.subjectName}>{s.label}</span>
                <span className={styles.subjectBlurb}>{s.blurb}</span>
                <span className={styles.subjectCount}>
                  {gamesForSubject(s.key).length}
                  {gamesForSubject(s.key).length === 1 ? ' game' : ' games'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — game */}
        {subject && !gameNeedingSkill && (
          <>
            {filterTags.length > 1 && (
              <div className={styles.filterRow} role="group" aria-label="Filter games by skill">
                <button
                  type="button"
                  className={`${styles.filterChip} ${!skillFilter ? styles.filterChipOn : ''}`}
                  style={{ '--accent': 'var(--kraft)' }}
                  aria-pressed={!skillFilter}
                  onClick={() => setSkillFilter(null)}
                >
                  all games
                </button>
                {filterTags.map(tag => (
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
            )}

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
                          if (!tag) return null;
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

        {/* Step 3 — a multi-skill game was picked: choose which skill it practices. */}
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
