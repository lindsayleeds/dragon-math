import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { OPERATION_BY_KEY, masteryTier } from '../data/operations';
import { GameChoiceModal } from '../components/GameChoiceModal';
import { DragonEggHatchery } from '../components/DragonEggHatchery';
import { DragonMunchers } from '../components/DragonMunchers';
import { SteppingStones } from '../components/SteppingStones';
import { MasteryDragon } from '../components/MasteryDragon';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import styles from '../styles/LearningLair.module.css';

const NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);

// Tier → label/swatch, ordered weakest → strongest for the legend.
const TIERS = [
  { key: 'new',        label: 'just starting',     className: 'tier_new' },
  { key: 'learning',   label: 'keep practicing',   className: 'tier_learning' },
  { key: 'practicing', label: 'getting there',     className: 'tier_practicing' },
  { key: 'strong',     label: 'almost mastered',   className: 'tier_strong' },
  { key: 'mastered',   label: 'mastered!',         className: 'tier_mastered' },
];
const TIER_LABEL = Object.fromEntries(TIERS.map(t => [t.key, t.label]));

export function LearningLairOperationPage() {
  const { operation } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const op = OPERATION_BY_KEY[operation];

  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [refreshKey] = useState(0);
  // When the player picked a game first, it arrives via router state.
  const initialGame = location.state?.game ?? null;
  // Dragon Munchers needs no number, so game-first launches its self-leveling
  // campaign straight away. Other games still pick a number from the grid first
  // — `pendingGame` makes that number-tap launch the chosen game (no chooser).
  const [selectedGameType, setSelectedGameType] = useState(
    initialGame === 'dragon-munchers' ? 'dragon-munchers' : null
  );
  const [progression] = useState(initialGame === 'dragon-munchers');
  const [pendingGame] = useState(initialGame === 'dragon-munchers' ? null : initialGame);
  // A game-first launch (Dragon Munchers from the chooser) starts with no number
  // picked, so it needs a base to practise. Draw it ONCE, in a lazy initialiser:
  // computed inline in the render body it was re-drawn on every render, and the
  // /api/mastery fetch resolving re-renders this page moments after the game
  // starts — which handed the running game a different baseNumber and rebuilt
  // its board out from under the player.
  const [fallbackBase] = useState(() => Math.floor(Math.random() * 12) + 1);

  // Quitting or finishing a game always returns to the lair's "Choose a skill /
  // Choose a game" fork, so the player lands on a deliberate picker rather than
  // mid-flow on the mastery grid.
  const returnToLair = () => {
    navigate('/learning-lair');
  };

  const loadMastery = async () => {
    if (!op) return;
    try {
      setLoading(true);
      const { operations } = await api.get('/api/mastery');
      console.log('Mastery data loaded for', op.key, operations[op.key]);
      setGrid(operations[op.key] || {});
    } catch (err) {
      console.error('Failed to load mastery:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMastery();
  }, [op, refreshKey]);

  // Count time in the lair (grid + any game) toward daily minutes, same as battles.
  usePlaytimeHeartbeat(true);

  if (!op) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.washiTopStrip} />
          <button className={styles.backTab} onClick={() => navigate("/learning-lair")}>
            ← learning lair
          </button>
          <div className={styles.titleWrap}>
            <span className={styles.titleIcon} aria-hidden>🤔</span>
            <h1 className={styles.title}>Hmm…</h1>
          </div>
        </header>
        <main className={styles.main}>
          <p className={styles.emptyNote}>That skill is not in the lair.</p>
        </main>
      </div>
    );
  }

  if (selectedGameType === "dragon-egg-hatchery") {
    const baseNum = selectedNumber ?? fallbackBase;
    return (
      <DragonEggHatchery
        operation={op.key}
        baseNumber={baseNum}
        onComplete={returnToLair}
      />
    );
  }

  if (selectedGameType === "dragon-munchers") {
    const baseNum = selectedNumber ?? fallbackBase;
    return (
      <DragonMunchers
        operation={op.key}
        baseNumber={baseNum}
        progression={progression}
        onComplete={returnToLair}
      />
    );
  }

  if (selectedGameType === "stepping-stones") {
    const baseNum = selectedNumber ?? fallbackBase;
    return (
      <SteppingStones
        baseNumber={baseNum}
        onComplete={returnToLair}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={() => navigate("/learning-lair")}>
          ← learning lair
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} style={{ color: op.color }} aria-hidden>
            {op.symbol}
          </span>
          <h1 className={styles.title}>{op.label}</h1>
          <p className={styles.subtitle}>— how well you know each number</p>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.loadingScreen}>
            <span className={styles.loadingGlyph}>✦</span>
            <p className={styles.loadingText}>gathering your notes…</p>
          </div>
        ) : error ? (
          <p className={styles.emptyNote}>Could not load your progress — try again later.</p>
        ) : (
          <>
            <div className={styles.numberGrid} style={{ "--accent": op.color }}>
              {NUMBERS.map(n => {
                const cell = grid?.[n];
                const tier = masteryTier(cell);
                const pct = cell && cell.accuracy != null
                  ? Math.round(cell.accuracy * 100)
                  : null;
                return (
                  <div
                    key={n}
                    title={`${op.label} with ${n}: ${TIER_LABEL[tier]}${pct != null ? ` · ${pct}%` : ""}`}
                    onClick={() => {
                      setSelectedNumber(n);
                      // Game-first: skip the chooser and launch the picked game.
                      if (pendingGame) setSelectedGameType(pendingGame);
                    }}
                  >
                    <MasteryDragon
                      tier={tier}
                      number={n}
                    />
                  </div>
                );
              })}
            </div>

            <div className={styles.legend}>
              {TIERS.filter(t => t.key !== 'new').map(t => (
                <span key={t.key} className={styles.legendItem}>
                  <span className={styles.legendDragon} aria-hidden>
                    <MasteryDragon tier={t.key} number="" size={26} />
                  </span>
                  {t.label}
                </span>
              ))}
            </div>
          </>
        )}
      </main>

      <GameChoiceModal
        operation={op.key}
        number={selectedNumber}
        isOpen={selectedNumber !== null && selectedGameType === null && !pendingGame}
        onClose={() => {
          setSelectedGameType(null);
          setSelectedNumber(null);
        }}
        onSelectGame={(gameName) => {
          setSelectedGameType(gameName);
        }}
      />
    </div>
  );
}
