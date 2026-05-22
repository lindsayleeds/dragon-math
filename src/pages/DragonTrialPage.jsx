import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDragonTrial, computeTrialOutcome } from '../hooks/useDragonTrial';
import { useAuthContext } from '../contexts/AuthContext';
import { OP_LABEL } from '../data/battleData';
import { MAP_NODES, WORLDS } from '../data/mapData';
import { BattleWallpaper } from '../components/map-paper/BattleWallpaper';
import { api } from '../api';
import { playYip, playVictory } from '../utils/sounds';
import styles from '../styles/BattlePage.module.css';
import trialStyles from '../styles/DragonTrialPage.module.css';

const OP_NAMES = {
  add: 'addition',
  sub: 'subtraction',
  mul: 'multiplication',
  div: 'division',
};

export function DragonTrialPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthContext();
  const playerAvatar = user?.avatar || '⚔️';
  const alreadyTaken = !!user?.dragon_trial_completed;

  const trial = useDragonTrial();

  // Guard manual /trial navigation after the flag has been flipped. Sidebar
  // normally hides the entry, but a refresh on a stale tab could land here.
  useEffect(() => {
    if (alreadyTaken) navigate('/map', { replace: true });
  }, [alreadyTaken, navigate]);
  if (alreadyTaken) return null;

  // World 5 colors for the page chrome — final-trial vibe.
  const world = WORLDS.find(w => w.id === 5);
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

  return (
    <div className={styles.page} style={worldVars}>
      <BattleWallpaper worldId={5} />
      <header className={styles.header}>
        <span className={styles.headerWashi} aria-hidden />
        <button className={styles.backBtn} onClick={() => navigate('/map')}>
          ← map
        </button>
        <span className={styles.nodeLabelWrap}>
          <span className={styles.nodeLabel}>🐉 Dragon's Trial</span>
        </span>
        <span className={styles.spacer} />
      </header>

      {trial.status === 'playing' ? (
        <TrialBoard trial={trial} playerAvatar={playerAvatar} />
      ) : (
        <TrialResults
          perOpPoints={trial.perOpPoints}
          onFinish={async ({ targetNodeId, perOp }) => {
            try {
              const resp = await api.post('/api/dragon-trial/complete', {
                target_node_id: targetNodeId,
                per_op: perOp,
              });
              if (resp?.user) updateUser(resp.user);
              playVictory();
              navigate('/map');
            } catch (err) {
              console.error('Failed to finish Dragon\'s Trial:', err);
              navigate('/map');
            }
          }}
        />
      )}
    </div>
  );
}

function TrialBoard({ trial, playerAvatar }) {
  const {
    problem,
    grid,
    layoutCols,
    layoutRows,
    wrongCellIndex,
    blanking,
    index,
    total,
    currentOp,
    aiScore,
    handleCellTap,
  } = trial;

  const onTap = (i) => {
    const value = grid[i];
    const wasCorrect = value === problem.answer;
    handleCellTap(i);
    if (wasCorrect) playYip();
  };

  // Whenever the AI scores another atmospheric point, growl. We piggyback on
  // aiScore so we don't need a separate prop.
  // (Skipped a useEffect for this — playGrowl is fire-and-forget and the
  //  trial advances quickly enough that the natural cadence works.)
  void aiScore;

  return (
    <>
      <section className={trialStyles.trialMeta}>
        <div className={trialStyles.trialProgress}>
          problem <strong>{index + 1}</strong> of {total}
        </div>
        <div className={trialStyles.trialOp}>
          testing <strong>{OP_NAMES[currentOp]}</strong> {OP_LABEL[currentOp]}
        </div>
      </section>

      <section className={styles.problemCard}>
        <p className={styles.problemLabel}>tap the answer</p>
        <p className={styles.problemText}>{problem.text} = ?</p>
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
            return (
              <button
                key={i}
                className={`${styles.cell} ${wrongCellIndex === i ? styles.cellWrong : ''}`}
                onClick={() => onTap(i)}
                disabled={blanking}
              >
                {blanking ? '' : n}
              </button>
            );
          })}
        </div>
      </section>

      <section className={trialStyles.trialFooter}>
        <span className={trialStyles.trialAvatar}>{playerAvatar}</span>
        <span className={trialStyles.trialHint}>steady your hand, traveler — the dragon watches</span>
        <span className={trialStyles.trialDragon}>🐉</span>
      </section>
    </>
  );
}

// Tier styling for each band. Fluent and Capable share the "passing" pill;
// Developing and Not-ready share the "keep practicing" pill.
const BAND_DISPLAY = {
  fluent:     { label: '★ fluent',     positive: true  },
  capable:    { label: '✓ capable',    positive: true  },
  developing: { label: '· developing', positive: false },
  not_ready:  { label: '· not ready',  positive: false },
};

function TrialResults({ perOpPoints, onFinish }) {
  const { perOp, highestPlacementOp, targetNodeId } = computeTrialOutcome(perOpPoints);
  const targetNode = MAP_NODES.find(n => n.id === targetNodeId);
  const targetWorld = WORLDS.find(w => targetNodeId >= w.nodeRange[0] && targetNodeId <= w.nodeRange[1]);
  const [submitting, setSubmitting] = useState(false);

  const handleClick = async () => {
    if (submitting) return;
    setSubmitting(true);
    await onFinish({ targetNodeId, perOp });
  };

  return (
    <div className={trialStyles.resultsWrap}>
      <h2 className={trialStyles.resultsTitle}>The dragon nods approvingly.</h2>
      <p className={trialStyles.resultsBlurb}>
        Here is what the trial revealed about your skills:
      </p>

      <div className={trialStyles.resultsTable}>
        {['add', 'sub', 'mul', 'div'].map(op => {
          const r = perOp[op];
          const display = BAND_DISPLAY[r.band] || BAND_DISPLAY.not_ready;
          return (
            <div key={op} className={trialStyles.resultRow}>
              <span className={trialStyles.resultOp}>{OP_LABEL[op]}</span>
              <span className={trialStyles.resultName}>{OP_NAMES[op]}</span>
              <span className={trialStyles.resultScore}>
                {r.score} / 1000
              </span>
              <span className={display.positive ? trialStyles.resultBadgeOn : trialStyles.resultBadgeOff}>
                {display.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className={trialStyles.resultsTarget}>
        {highestPlacementOp ? (
          <>
            Your highest fluency is <strong>{OP_NAMES[highestPlacementOp]}</strong> — the
            road carries you to <strong>{targetNode?.icon} {targetNode?.label}</strong>
            {targetWorld && <> in <em>{targetWorld.name.toLowerCase()}</em></>}.
          </>
        ) : (
          <>
            A fresh start is the best start. The road begins at
            <strong> {targetNode?.icon} {targetNode?.label}</strong>.
          </>
        )}
      </p>

      <button
        type="button"
        className={trialStyles.resultsButton}
        onClick={handleClick}
        disabled={submitting}
      >
        {submitting ? 'setting your course…' : '→ continue to the map'}
      </button>
    </div>
  );
}
