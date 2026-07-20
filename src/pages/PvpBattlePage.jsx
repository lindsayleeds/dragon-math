import { useNavigate, useParams } from 'react-router-dom';
import { useBattlePvP } from '../hooks/useBattlePvP';
import { useRealtime } from '../contexts/RealtimeContext';
import { useAuthContext } from '../contexts/AuthContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { renderAvatar } from '../utils/avatar';
import { DragonPrizeReveal } from '../components/DragonPrizeReveal';
import styles from '../styles/BattlePage.module.css';

// Live player-vs-player battle. Mirrors the single-player BattlePage layout (and
// reuses its stylesheet) but the opponent is another kid, driven over the socket
// — no companion dock, bond powers, or capture flow.
export function PvpBattlePage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const rt = useRealtime();
  const { user } = useAuthContext();
  const playerAvatar = user?.avatar || '⚔️';
  const playerName = user?.username || 'You';

  usePlaytimeHeartbeat(true);

  const {
    problem,
    grid,
    layoutCols,
    layoutRows,
    playerScore,
    aiScore,
    status,
    target,
    opponent,
    nodeId,
    endReason,
    opponentLeft,
    opponentScored,
    roundResult,
    wrongCellIndex,
    gridLocked,
    blanking,
    matchDurationMs,
    handleCellTap,
  } = useBattlePvP(matchId);

  const oppName = opponent?.username || 'Opponent';
  const oppIcon = opponent?.avatar ? renderAvatar(opponent.avatar) : '🐲';

  if (status === 'ended') {
    return (
      <div className={styles.errorScreen}>
        <p>That race has ended.</p>
        <button onClick={() => navigate('/tribes')}>Back to tribes</button>
      </div>
    );
  }

  if (status === 'connecting' || !problem) {
    return (
      <div className={styles.errorScreen}>
        <p>Lining up your race…</p>
      </div>
    );
  }

  const playing = status === 'playing';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.headerWashi} aria-hidden />
        <button className={styles.backBtn} onClick={() => navigate('/tribes')}>
          ← leave
        </button>
        <span className={styles.nodeLabelWrap}>
          <span className={styles.nodeLabel}>⚔️ Math Race</span>
        </span>
        <span className={styles.spacer} />
      </header>

      <section className={styles.scoreboard}>
        <ScoreCard icon={renderAvatar(playerAvatar)} name={playerName} score={playerScore} target={target} variant="player" />
        <div className={styles.vs}>vs.</div>
        <ScoreCard icon={oppIcon} name={oppName} score={aiScore} target={target} variant="foe" grabbing={opponentScored} />
      </section>

      <section className={styles.problemCard}>
        <p className={styles.problemLabel}>tap the answer</p>
        <p className={styles.problemText}>{problem.text} = ?</p>
      </section>

      <section className={styles.gridWrap}>
        <div
          className={`${styles.grid} ${gridLocked ? styles.gridLocked : ''}`}
          style={{
            gridTemplateColumns: `repeat(${layoutCols}, 1fr)`,
            aspectRatio: `${layoutCols} / ${layoutRows}`,
          }}
        >
          {grid.map((n, i) => {
            if (n === null) return <div key={i} className={styles.cellSpacer} />;
            const classes = [styles.cell, wrongCellIndex === i ? styles.cellWrong : ''].filter(Boolean).join(' ');
            return (
              <button
                key={i}
                className={classes}
                onClick={() => handleCellTap(i)}
                disabled={!playing || blanking || gridLocked}
              >
                {blanking ? '' : n}
              </button>
            );
          })}
        </div>
      </section>

      {opponentLeft && playing && (
        <p className={styles.problemLabel} style={{ textAlign: 'center' }}>
          {oppName} got disconnected — waiting for them to come back…
        </p>
      )}

      {roundResult && playing && (
        <RoundResultPopup
          iWon={roundResult.iWon}
          avatar={roundResult.iWon ? renderAvatar(playerAvatar) : oppIcon}
          name={roundResult.iWon ? 'You' : oppName}
          playerScore={playerScore}
          oppScore={aiScore}
        />
      )}

      {!playing && (
        <ResultModal
          won={status === 'won'}
          oppName={oppName}
          endReason={endReason}
          matchDurationMs={matchDurationMs}
          canRematch={!!opponent?.id && nodeId != null}
          onRematch={() => { rt?.sendChallenge(opponent.id, nodeId); navigate('/tribes'); }}
          onLeave={() => navigate('/tribes')}
        />
      )}
    </div>
  );
}

// Shown between rounds: whose avatar buzzed in first, plus the running score.
// Both players see this off the same server message, for the same duration, so
// they drop into the next problem together.
function RoundResultPopup({ iWon, avatar, name, playerScore, oppScore }) {
  return (
    <div className={styles.roundPopupOverlay}>
      <div className={`${styles.roundPopup} ${iWon ? styles.roundPopupWon : styles.roundPopupLost}`}>
        <div className={styles.roundPopupAvatar}>{avatar}</div>
        <p className={styles.roundPopupText}>
          {iWon ? 'You got it first! 🎉' : `${name} got it first!`}
        </p>
        <p className={styles.roundPopupScore}>
          <span className={styles.roundPopupYou}>{playerScore}</span>
          <span className={styles.roundPopupDash}>–</span>
          <span className={styles.roundPopupThem}>{oppScore}</span>
        </p>
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
          <div className={styles.scoreBarFill} style={{ width: `${(score / target) * 100}%` }} />
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

function ResultModal({ won, oppName, endReason, matchDurationMs, canRematch, onRematch, onLeave }) {
  let title;
  let desc;
  if (won) {
    title = 'You won the race!';
    desc = endReason === 'forfeit' || endReason === 'disconnect'
      ? `${oppName} left the race — the win is yours!`
      : `You reached the finish before ${oppName}. Speedy!`;
  } else {
    title = `${oppName} finished first!`;
    desc = 'So close! Want a rematch?';
  }
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalIcon}>{won ? '🏆' : '💨'}</div>
        <h2 className={styles.modalTitle}>{title}</h2>
        <p className={styles.modalDesc}>{desc}</p>
        {won && matchDurationMs != null && (
          <p className={styles.modalTime}>Total time: {formatDuration(matchDurationMs)}</p>
        )}
        <DragonPrizeReveal performance={won ? 'high' : 'low'} />
        <div className={styles.modalButtons}>
          <button className={styles.modalMap} onClick={onLeave}>← back to tribes</button>
          {canRematch && (
            <button className={styles.modalRetry} onClick={onRematch}>↻ rematch</button>
          )}
        </div>
      </div>
    </div>
  );
}
