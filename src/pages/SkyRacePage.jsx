import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { useCompanionContext } from '../contexts/CompanionContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import { useSkyRace, ROUTES, loadBestMs, formatRaceTime } from '../hooks/useSkyRace';
import { playYip, playVictory } from '../utils/sounds';
import styles from '../styles/SkyRacePage.module.css';

// Sky Race Deliveries — ride your companion dragon and deliver berries to
// floating villages. Each fork in the sky-road is a math problem; pick the
// cloud path with the right answer to keep soaring.

const DRAGON_SPRITE = '/dragon_pngs/1.png';

export function SkyRacePage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { activeCompanion } = useCompanionContext();
  const race = useSkyRace(user?.username);

  usePlaytimeHeartbeat(race.status === 'flying');

  return (
    <div className={styles.page}>
      <SkyBackdrop altitude={race.altitude} flying={race.status === 'flying'} />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/map')}>
          ← map
        </button>
        <span className={styles.title}>🫐 Sky Race Deliveries</span>
        <span className={styles.spacer} />
      </header>

      {race.status === 'ready' && (
        <RoutePicker username={user?.username} companion={activeCompanion} onPick={race.startRun} />
      )}
      {race.status === 'flying' && <FlightBoard race={race} companion={activeCompanion} />}
      {race.status === 'done' && (
        <DeliveryResults
          result={race.result}
          route={race.route}
          onAgain={race.backToRoutes}
          onMap={() => navigate('/map')}
        />
      )}
    </div>
  );
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function SkyBackdrop({ altitude, flying }) {
  return (
    <div className={styles.sky} aria-hidden>
      <span className={`${styles.cloud} ${styles.cloudA}`}>☁️</span>
      <span className={`${styles.cloud} ${styles.cloudB}`}>☁️</span>
      <span className={`${styles.cloud} ${styles.cloudC}`}>☁️</span>
      <span className={`${styles.island} ${styles.islandA}`}>🏝️</span>
      <span className={`${styles.island} ${styles.islandB}`}>⛰️</span>
      <span className={styles.birds}>🕊️</span>
      {flying && (
        <img
          src={DRAGON_SPRITE}
          alt=""
          className={styles.dragon}
          // altitude 100 = near the top of the scene, MIN = skimming treetops
          style={{ top: `${78 - altitude * 0.58}%` }}
        />
      )}
    </div>
  );
}

// ─── Ready: pick a wind route ────────────────────────────────────────────────

function RoutePicker({ username, companion, onPick }) {
  return (
    <main className={styles.board}>
      <section className={styles.introCard}>
        <img src={DRAGON_SPRITE} alt="" className={styles.introDragon} />
        <h1 className={styles.introTitle}>Berry delivery day!</h1>
        <p className={styles.introBlurb}>
          The floating villages ordered berries, and <strong>{companion?.name || 'your dragon'}</strong> is
          ready to fly. At every fork in the sky-road, tap the cloud with the
          right answer to keep soaring. Wrong turns only dip you a little —
          every delivery makes it home!
        </p>
      </section>

      <section className={styles.routeList}>
        {ROUTES.map(route => {
          const best = loadBestMs(username, route.id);
          return (
            <button key={route.id} className={styles.routeCard} onClick={() => onPick(route.id)}>
              <span className={styles.routeIcon}>{route.icon}</span>
              <span className={styles.routeName}>{route.name}</span>
              <span className={styles.routeBlurb}>{route.blurb}</span>
              <span className={styles.routeBest}>
                {best ? `best delivery: ${formatRaceTime(best)}` : 'no deliveries yet'}
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}

// ─── Flying: the delivery run ────────────────────────────────────────────────

function FlightBoard({ race, companion }) {
  const {
    problem, choices, wrongPicks, gliding,
    forkIndex, totalForks, altitude, berries, streak, pickPath,
  } = race;

  const onPick = (i) => {
    const correct = pickPath(i);
    if (correct) playYip();
    if (correct && forkIndex + 1 >= totalForks) playVictory();
  };

  return (
    <main className={styles.board}>
      <section className={styles.hud}>
        <span className={styles.hudItem}>🧺 delivery {Math.min(forkIndex + 1, totalForks)} of {totalForks}</span>
        <span className={styles.hudItem}>🫐 × {berries}</span>
        {streak >= 3 && <span className={`${styles.hudItem} ${styles.hudStreak}`}>✨ tailwind! double berries</span>}
        <span className={styles.hudItem} title="altitude">
          <span className={styles.altBar}>
            <span className={styles.altFill} style={{ width: `${altitude}%` }} />
          </span>
        </span>
      </section>

      <section className={styles.problemCard}>
        <p className={styles.problemLabel}>
          {gliding ? `${companion?.name || 'your dragon'} soars ahead… 🌬️` : 'which cloud path?'}
        </p>
        <p className={styles.problemText}>{problem ? `${problem.text} = ?` : ''}</p>
      </section>

      <section className={styles.paths}>
        {choices.map((value, i) => {
          const missed = wrongPicks.includes(i);
          return (
            <button
              key={`${forkIndex}-${i}`}
              className={`${styles.pathCloud} ${missed ? styles.pathMissed : ''} ${gliding ? styles.pathGliding : ''}`}
              onClick={() => onPick(i)}
              disabled={gliding || missed}
            >
              <span className={styles.pathValue}>{missed ? '🌫️' : value}</span>
            </button>
          );
        })}
      </section>

      <p className={styles.flightHint}>
        wrong turns just dip you a little — keep flying, you always make it!
      </p>
    </main>
  );
}

// ─── Done: delivery complete ─────────────────────────────────────────────────

function DeliveryResults({ result, route, onAgain, onMap }) {
  if (!result) return null;
  return (
    <main className={styles.board}>
      <section className={styles.resultsCard}>
        <img src={DRAGON_SPRITE} alt="" className={styles.introDragon} />
        <h1 className={styles.introTitle}>All berries delivered! 🎉</h1>
        <p className={styles.resultLine}>
          {route?.icon} <strong>{route?.name}</strong> route finished in{' '}
          <strong>{formatRaceTime(result.ms)}</strong>
          {result.newBest && <span className={styles.newBest}> — new best! 🏅</span>}
        </p>
        {!result.newBest && result.bestMs && (
          <p className={styles.resultSub}>your best is {formatRaceTime(result.bestMs)} — so close!</p>
        )}
        <p className={styles.resultLine}>
          🫐 <strong>{result.berries}</strong> berries earned
          {result.highFlyer && <span className={styles.highFlyer}> · ☁️ high flyer bonus!</span>}
        </p>
        <div className={styles.resultButtons}>
          <button className={styles.primaryBtn} onClick={onAgain}>🌬️ fly again</button>
          <button className={styles.secondaryBtn} onClick={onMap}>← back to the map</button>
        </div>
      </section>
    </main>
  );
}
