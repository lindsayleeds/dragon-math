import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBattle } from '../hooks/useBattle';
import { useNodeProgress } from '../hooks/useNodeProgress';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useAuthContext } from '../contexts/AuthContext';
import { useCompanionContext } from '../contexts/CompanionContext';
import { MAP_NODES, WORLDS } from '../data/mapData';
import { COMPANIONS, NODE_TO_COMPANION } from '../data/companions';
import { playVictory, playDefeat } from '../utils/sounds';
import { BattleWallpaper } from '../components/map-paper/BattleWallpaper';
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
    layoutCols,
    layoutRows,
    playerScore,
    aiScore,
    wrongCellIndex,
    blanking,
    aiSolvedAnswer,
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

  const world = WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1]);
  const worldVars = world
    ? {
        '--world-bg': world.bgColor,
        '--world-bg-alt': world.washColor,
        '--world-accent': world.accentColor,
        '--world-chapter': world.chapterColor,
        '--world-cell-border': world.washColor,
        '--boss-border': world.accentColor,
      }
    : {};

  const opponentName = isBoss ? `${node.label}` : 'goblin';
  const opponentIcon = isBoss ? '🐉' : '👺';

  return (
    <div className={styles.page} style={worldVars}>
      <BattleWallpaper worldId={world?.id} />
      <header className={styles.header}>
        <span className={styles.headerWashi} aria-hidden />
        <button className={styles.backBtn} onClick={() => navigate('/map')}>
          ← map
        </button>
        <span className={styles.nodeLabelWrap}>
          <span className={styles.nodeLabel}>{node.icon} {node.label}</span>
        </span>
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
        <div className={styles.vs}>vs.</div>
        <ScoreCard
          icon={opponentIcon}
          name={opponentName}
          score={aiScore}
          target={target}
          variant={isBoss ? 'boss' : 'foe'}
          grabbing={aiSolvedAnswer != null}
        />
      </section>

      <section className={styles.problemCard}>
        <p className={styles.problemLabel}>tap the answer</p>
        <p className={styles.problemText}>
          {problem.text} ={' '}
          {aiSolvedAnswer != null ? (
            <span className={styles.problemAnswerReveal}>{aiSolvedAnswer}</span>
          ) : (
            '?'
          )}
        </p>
      </section>

      <section className={styles.gridWrap}>
        <div
          className={styles.grid}
          style={{
            gridTemplateColumns: `repeat(${layoutCols}, 1fr)`,
            aspectRatio: `${layoutCols} / ${layoutRows}`,
          }}
        >
          {grid.map((n, i) => {
            if (n === null) return <div key={i} className={styles.cellSpacer} />;
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
        <span className={styles.companionLabel}>your teammate</span>
        <span className={styles.companionCta}>ask {companion.name} to help</span>
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

function ScoreCard({ icon, name, score, target, variant, grabbing = false }) {
  return (
    <div className={`${styles.scoreCard} ${styles[`scoreCard_${variant}`]}`}>
      <div className={`${styles.scoreIcon} ${grabbing ? styles.scoreIconGrabbing : ''}`}>{icon}</div>
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
        <h2 className={styles.modalTitle}>{won ? 'Victory!' : 'So close!'}</h2>
        <p className={styles.modalDesc}>
          {won
            ? (isBoss ? 'The dragon bows to you!' : 'You reached 10 before your foe — onward, traveler.')
            : 'Your foe reached 10 first. Take a breath and try again?'}
        </p>
        {won && matchDurationMs != null && (
          <p className={styles.modalTime}>Total time: {formatDuration(matchDurationMs)}</p>
        )}
        <div className={styles.modalButtons}>
          <button className={styles.modalMap} onClick={onMap}>
            {won ? '→ keep going' : '← back to map'}
          </button>
          {!won && (
            <button className={styles.modalRetry} onClick={onRetry}>↻ try again</button>
          )}
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

