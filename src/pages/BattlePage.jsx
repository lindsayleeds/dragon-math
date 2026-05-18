import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBattle } from '../hooks/useBattle';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useAuthContext } from '../contexts/AuthContext';
import { useCompanionContext } from '../contexts/CompanionContext';
import { MAP_NODES } from '../data/mapData';
import { COMPANIONS, NODE_TO_COMPANION } from '../data/companions';
import { playVictory, playDefeat } from '../utils/sounds';
import styles from '../styles/BattlePage.module.css';

export function BattlePage() {
  const { nodeId: nodeIdParam } = useParams();
  const nodeId = Number(nodeIdParam);
  const node = MAP_NODES.find(n => n.id === nodeId);
  const navigate = useNavigate();
  const { username, markNodeComplete } = useNodeProgress();
  const { user } = useAuthContext();
  const { activeCompanion, ownsCompanion, capture } = useCompanionContext();
  const playerAvatar = user?.avatar || '⚔️';

  usePlaytimeHeartbeat(true);

  const {
    problem,
    grid,
    gridSize,
    playerScore,
    aiScore,
    wrongCellIndex,
    blanking,
    status,
    isBoss,
    target,
    matchDurationMs,
    handleCellTap,
    reset,
    hintCellIndices,
    hintColor,
    bondCooldownMs,
    bondCooldownTotalMs,
    triggerBondPower,
  } = useBattle(nodeId);

  // Show the capture celebration the first time a boss is befriended.
  const newCompanionId = NODE_TO_COMPANION[nodeId];
  const [capturedThisBattle, setCapturedThisBattle] = useState(false);
  const shouldShowCapture =
    status === 'won' && isBoss && newCompanionId && !ownsCompanion(newCompanionId) && !capturedThisBattle;

  // Persist win once it happens
  useEffect(() => {
    if (status === 'won') {
      const stars = computeStars(aiScore, target);
      markNodeComplete(nodeId, stars);
      playVictory();
    } else if (status === 'lost') {
      playDefeat();
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBefriend() {
    try {
      await capture(newCompanionId);
    } catch (err) {
      console.error('Failed to befriend:', err);
    }
    setCapturedThisBattle(true);
  }

  if (!node) {
    return (
      <div className={styles.errorScreen}>
        <p>Unknown node.</p>
        <button onClick={() => navigate('/map')}>Back to map</button>
      </div>
    );
  }

  const opponentName = isBoss ? `${node.label}` : 'Goblin';
  const opponentIcon = isBoss ? '🐉' : '👺';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/map')}>
          ← Map
        </button>
        <span className={styles.nodeLabel}>{node.icon} {node.label}</span>
        <span className={styles.spacer} />
      </header>

      <section className={styles.scoreboard}>
        <ScoreCard
          icon={playerAvatar}
          name={username}
          score={playerScore}
          target={target}
          variant="player"
        />
        <div className={styles.vs}>VS</div>
        <ScoreCard
          icon={opponentIcon}
          name={opponentName}
          score={aiScore}
          target={target}
          variant={isBoss ? 'boss' : 'foe'}
        />
      </section>

      <section className={styles.problemCard}>
        <p className={styles.problemLabel}>Tap the answer</p>
        <p className={styles.problemText}>{problem.text} = ?</p>
      </section>

      {status === 'playing' && !blanking && (
        <div className={styles.shuffleBarTrack} aria-hidden="true">
          <div className={styles.shuffleBarFill} />
        </div>
      )}
      {status === 'playing' && blanking && (
        <div className={styles.shuffleBarTrack} aria-hidden="true" />
      )}

      <section className={styles.gridWrap}>
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
        >
          {grid.map((n, i) => {
            const isHinted = !blanking && hintCellIndices?.includes(i);
            return (
              <button
                key={i}
                className={`${styles.cell} ${wrongCellIndex === i ? styles.cellWrong : ''} ${isHinted ? styles.cellHinted : ''}`}
                style={isHinted ? { background: hintColor, borderColor: hintColor } : undefined}
                onClick={() => handleCellTap(i)}
                disabled={status !== 'playing' || blanking}
              >
                {blanking ? '' : n}
              </button>
            );
          })}
        </div>
      </section>

      <CompanionDock
        companion={activeCompanion}
        cooldownMs={bondCooldownMs}
        cooldownTotalMs={bondCooldownTotalMs}
        disabled={status !== 'playing' || hintCellIndices !== null}
        onTrigger={() => triggerBondPower(activeCompanion)}
      />

      {shouldShowCapture && (
        <CaptureOverlay
          companion={COMPANIONS[newCompanionId]}
          onContinue={handleBefriend}
        />
      )}

      {status !== 'playing' && !shouldShowCapture && (
        <ResultModal
          won={status === 'won'}
          isBoss={isBoss}
          matchDurationMs={matchDurationMs}
          onRetry={reset}
          onMap={() => navigate('/map')}
        />
      )}
    </div>
  );
}

function CompanionDock({ companion, cooldownMs, cooldownTotalMs, disabled, onTrigger }) {
  if (!companion) return null;
  const onCooldown = cooldownMs > 0;
  const pct = cooldownTotalMs > 0 ? Math.min(100, (cooldownMs / cooldownTotalMs) * 100) : 0;
  const secondsLeft = Math.ceil(cooldownMs / 1000);
  return (
    <section className={styles.companionDock}>
      <div className={styles.companionInfo}>
        <span className={styles.companionLabel}>Teammate</span>
        <span className={styles.companionCta}>Ask {companion.name} to help</span>
      </div>
      <button
        type="button"
        className={`${styles.bondButton} ${onCooldown ? styles.bondButtonCooldown : ''}`}
        style={{
          '--bond-color': companion.bondPower.highlightColor,
          '--cooldown-pct': `${pct}%`,
        }}
        onClick={onTrigger}
        disabled={disabled || onCooldown}
        aria-label={`Ask ${companion.name} to help (${companion.bondPower.name})`}
      >
        <span className={styles.bondIcon}>{companion.icon}</span>
        {onCooldown && <span className={styles.bondCooldownText}>{secondsLeft}</span>}
      </button>
    </section>
  );
}

function CaptureOverlay({ companion, onContinue }) {
  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modal} ${styles.captureModal}`}>
        <div className={styles.captureSparkles}>✨</div>
        <div className={styles.captureIcon}>{companion.icon}</div>
        <h2 className={styles.modalTitle}>You befriended {companion.name}!</h2>
        <p className={styles.modalDesc}>{companion.tagline}</p>
        <p className={styles.captureBondHint}>
          New Bond Power unlocked: <strong>{companion.bondPower.name}</strong>
        </p>
        <div className={styles.modalButtons}>
          <button className={styles.modalMap} onClick={onContinue}>
            → Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ icon, name, score, target, variant }) {
  return (
    <div className={`${styles.scoreCard} ${styles[`scoreCard_${variant}`]}`}>
      <div className={styles.scoreIcon}>{icon}</div>
      <div className={styles.scoreInfo}>
        <div className={styles.scoreName}>{name}</div>
        <div className={styles.scoreNumbers}>
          <span className={styles.scoreCurrent}>{score}</span>
          <span className={styles.scoreSlash}>/{target}</span>
        </div>
        <div className={styles.scoreBar}>
          <div
            className={styles.scoreBarFill}
            style={{ width: `${(score / target) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function ResultModal({ won, isBoss, matchDurationMs, onRetry, onMap }) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalIcon}>{won ? (isBoss ? '👑' : '⭐') : '💔'}</div>
        <h2 className={styles.modalTitle}>{won ? 'Victory!' : 'Defeated'}</h2>
        <p className={styles.modalDesc}>
          {won
            ? (isBoss ? 'The dragon bows to you!' : 'You beat your opponent to 10!')
            : 'Your opponent got to 10 first. Try again?'}
        </p>
        {won && matchDurationMs != null && (
          <p className={styles.modalTime}>Total time: {formatDuration(matchDurationMs)}</p>
        )}
        <div className={styles.modalButtons}>
          {!won && (
            <button className={styles.modalRetry} onClick={onRetry}>↻ Retry</button>
          )}
          <button className={styles.modalMap} onClick={onMap}>
            {won ? '→ Continue' : 'Back to map'}
          </button>
        </div>
      </div>
    </div>
  );
}

function computeStars(aiScore, target) {
  // 3 stars if AI got fewer than half; 2 if less than ~75%, else 1.
  if (aiScore < target * 0.5) return 3;
  if (aiScore < target * 0.75) return 2;
  return 1;
}

