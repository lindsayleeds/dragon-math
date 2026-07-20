import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from '../styles/SteppingStones.module.css';
import { soundEffects } from '../utils/soundEffects';

const NUM_STONES = 10;
const CHOICES_PER_HOP = 4;

// Timing for the "stamp the number, then the otter hops" beat. Kept as snappy
// as possible so a quick kid can race across the stream — the hop still
// animates, just fast. (Must stay in sync with the otter transition/animation
// durations in SteppingStones.module.css.)
const STAMP_MS = 60; // number flashes onto the rock this long before the hop
const HOP_MS = 160; // how long the otter takes to leap onto the rock
const SINK_MS = 750; // otter sinks under the water (and the splash plays out)
const RESET_MS = 600; // pause on the near bank before the next attempt

// The choices float as a ring around the target stone. Because the path
// zig-zags diagonally, a fixed layout drops pads right on top of neighboring
// stones (and the otter). Instead we spin the ring to the orientation that
// keeps every pad as far as possible from the stones/otter already on screen.
// The ring radius scales with the stream width so the pads tuck in closer on
// a narrow phone screen instead of crowding the banks.
const PAD_RING_MAX_PX = 62; // ring radius on a full-width stream

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Droplets that fan upward and outward when the otter plunges in (px offsets).
const SPLASH_DROPLETS = [
  { tx: -44, ty: -28, delay: 0.02 },
  { tx: -30, ty: -48, delay: 0 },
  { tx: -15, ty: -58, delay: 0.05 },
  { tx: 0, ty: -64, delay: 0.02 },
  { tx: 15, ty: -58, delay: 0.05 },
  { tx: 30, ty: -48, delay: 0 },
  { tx: 44, ty: -28, delay: 0.02 },
  { tx: -22, ty: -40, delay: 0.07 },
  { tx: 22, ty: -40, delay: 0.07 },
];

// Pick pad positions (% of the stream) that ring the target without colliding
// with any occupied point (other stones + the otter), given pixel dimensions.
function placePads(target, occupied, count, size) {
  const { w, h } = size;
  if (!w || !h || count === 0) return [];
  // Pull the ring in on narrow screens so the pads don't spill onto the banks.
  const ring = clamp(w * 0.135, 46, PAD_RING_MAX_PX);
  const tx = (target.x / 100) * w;
  const ty = (target.y / 100) * h;
  const occ = occupied.map((o) => ({ x: (o.x / 100) * w, y: (o.y / 100) * h }));
  const sector = (2 * Math.PI) / count;

  const STEPS = 36;
  let best = null;
  let bestClear = -Infinity;
  for (let s = 0; s < STEPS; s++) {
    const rot = (s / STEPS) * sector;
    const pts = [];
    let minClear = Infinity;
    for (let k = 0; k < count; k++) {
      const a = rot + k * sector - Math.PI / 2; // start the ring near the top
      const px = tx + Math.cos(a) * ring;
      const py = ty + Math.sin(a) * ring;
      pts.push({ px, py });
      for (const o of occ) {
        const d = Math.hypot(px - o.x, py - o.y);
        if (d < minClear) minClear = d;
      }
    }
    if (minClear > bestClear) {
      bestClear = minClear;
      best = pts;
    }
  }
  return best.map(({ px, py }) => ({
    x: clamp((px / w) * 100, 8, 92),
    y: clamp((py / h) * 100, 6, 94),
  }));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A zig-zag path of stones drifting from the left bank toward the right bank
// as it descends the vertical stream. Positions are percentages of the stream.
function buildPath(n) {
  const positions = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1); // 0..1 progress down the stream
    const xBase = 22 + t * 56; // overall left -> right drift
    const zig = (i % 2 === 0 ? -1 : 1) * 8; // alternating zig-zag
    positions.push({
      x: clamp(xBase + zig, 16, 84),
      y: clamp(10 + t * 78, 8, 90),
    });
  }
  return positions;
}

// Each hop offers the correct next multiple alongside plausible distractors:
// off-by-one/two skip-count slips and the tempting "over-skip" to the multiple
// after the target. The kid has to work out which pad is the true next multiple.
function generateHops(baseNumber) {
  const hops = [];
  for (let i = 1; i <= NUM_STONES; i++) {
    const target = baseNumber * i;
    const previous = new Set(
      Array.from({ length: i - 1 }, (_, k) => baseNumber * (k + 1))
    );
    const candidates = [
      target + 1,
      target - 1,
      target + 2,
      target - 2,
      target + baseNumber, // over-skip: the multiple *after* this one
      target + baseNumber + 1,
    ];
    const pool = [];
    for (const c of candidates) {
      // Skip non-positive, the answer itself, and already-locked multiples.
      if (c > 0 && c !== target && !previous.has(c) && !pool.includes(c)) {
        pool.push(c);
      }
    }
    const distractors = shuffle(pool).slice(0, CHOICES_PER_HOP - 1);
    const choices = shuffle([
      { value: target, isCorrect: true },
      ...distractors.map((value) => ({ value, isCorrect: false })),
    ]);
    hops.push({ target, choices });
  }
  return hops;
}

export function SteppingStones({ baseNumber, onComplete }) {
  const [hops] = useState(() => generateHops(baseNumber));
  const [path] = useState(() => buildPath(NUM_STONES));
  const [currentIndex, setCurrentIndex] = useState(0); // stones the otter has landed on
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [streak, setStreak] = useState(0);
  const [stamping, setStamping] = useState(null); // { index, value } being placed on a rock
  const [otterHopping, setOtterHopping] = useState(false);
  const [otterOverride, setOtterOverride] = useState(null); // force the otter to a spot (wrong-rock jump)
  const [otterSinking, setOtterSinking] = useState(false); // otter plunges into the water
  const [plungeAt, setPlungeAt] = useState(null); // where the splash bursts
  const [otterKey, setOtterKey] = useState(0); // bump to remount the otter at the start (no slide-back)
  const [busy, setBusy] = useState(false); // lock input during an animation
  const [restarts, setRestarts] = useState(0);
  const [showReset, setShowReset] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalMs, setFinalMs] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null); // top-10 best times (this number)
  const [prevBest, setPrevBest] = useState(null); // best time before this run, for the verdict
  const [streamSize, setStreamSize] = useState({ w: 0, h: 0 });
  const runStartRef = useRef(0);
  const streamRef = useRef(null);

  // Start the clock on mount (Date.now() can't run during render).
  useEffect(() => {
    runStartRef.current = Date.now();
  }, []);

  // Track the stream's pixel size so pad placement can detect real overlaps
  // (x% and y% map to different pixel amounts, so % math alone won't do).
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return undefined;
    const update = () =>
      setStreamSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tick the run timer until the crossing is won.
  useEffect(() => {
    if (gameOver) return undefined;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - runStartRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [gameOver]);

  // On a win, fold this run into the per-number leaderboard (kept in
  // localStorage so it persists across visits) and remember the prior best so
  // we can tell the kid whether they beat it.
  useEffect(() => {
    if (!won || finalMs == null) return;
    const key = `dragonmath:steppingstones:leaderboard:${baseNumber}`;
    let prior = [];
    try {
      prior = JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      prior = [];
    }
    const priorBest = prior.length ? Math.min(...prior.map((e) => e.ms)) : null;
    const current = { ms: finalMs, date: new Date().toISOString(), current: true };
    const top10 = [...prior.map((e) => ({ ...e, current: false })), current]
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 10);
    try {
      localStorage.setItem(
        key,
        JSON.stringify(top10.map(({ ms, date }) => ({ ms, date })))
      );
    } catch {
      /* private mode / storage full — leaderboard just won't persist */
    }
    setPrevBest(priorBest);
    setLeaderboard(top10);
  }, [won, finalMs, baseNumber]);

  // Otter sits to the left of stone 1 before the first hop, then on each rock.
  const startPos = { x: clamp(path[0].x - 14, 3, 50), y: path[0].y };
  const otterPos = currentIndex === 0 ? startPos : path[currentIndex - 1];
  const otterDisplayPos = otterOverride ?? otterPos; // override drives the wrong-rock jump
  const targetStone = path[currentIndex]; // the "?" rock the otter is heading for

  // Ring the answer pads around the target, dodging every other stone + the otter.
  const padPositions = useMemo(() => {
    if (!targetStone) return [];
    const count = hops[currentIndex]?.choices.length ?? 0;
    const occupied = [
      ...path.filter((_, i) => i !== currentIndex),
      otterPos,
    ];
    return placePads(targetStone, occupied, count, streamSize);
  }, [targetStone, otterPos, path, hops, currentIndex, streamSize]);

  const handleStoneClick = useCallback(
    (choice, padPos) => {
      if (busy || gameOver) return;

      if (!choice.isCorrect) {
        // Wrong answer: the otter leaps onto the wrong pad, then plunges into
        // the water with a splash before the run resets to the near bank.
        setStreak(0);
        setBusy(true);
        setStamping(null);
        setOtterOverride(padPos); // hop target = the pad the kid tapped
        setOtterHopping(true);

        setTimeout(() => {
          // He lands, then drops under the surface.
          setOtterHopping(false);
          setOtterSinking(true);
          setPlungeAt(padPos);
          soundEffects.playSplash();
        }, HOP_MS);

        setTimeout(() => {
          // Reset the run; remount the otter so he reappears at the start
          // instead of sliding back across underwater.
          setOtterSinking(false);
          setOtterOverride(null);
          setPlungeAt(null);
          setOtterKey((k) => k + 1);
          setCurrentIndex(0);
          setRestarts((r) => r + 1);
          setShowReset(true);
          runStartRef.current = Date.now();
          setElapsedMs(0);
        }, HOP_MS + SINK_MS);

        setTimeout(() => {
          setBusy(false);
          setShowReset(false);
        }, HOP_MS + SINK_MS + RESET_MS);
        return;
      }

      // Correct: stamp the number on the target rock, pause, then the otter hops.
      const landingIndex = currentIndex;
      const isFinal = landingIndex + 1 === NUM_STONES;
      const runMs = Date.now() - runStartRef.current;
      soundEffects.playCorrect();
      setStreak((prev) => prev + 1);
      setBusy(true);
      setStamping({ index: landingIndex, value: choice.value });

      setTimeout(() => {
        setCurrentIndex(landingIndex + 1); // moves the otter -> CSS transition hops it over
        setOtterHopping(true);
      }, STAMP_MS);

      setTimeout(() => {
        setStamping(null);
        setOtterHopping(false);
        setBusy(false);
        if (isFinal) {
          setFinalMs(runMs);
          setGameOver(true);
          setWon(true);
          soundEffects.playWin();
        }
      }, STAMP_MS + HOP_MS);
    },
    [busy, gameOver, currentIndex]
  );

  if (gameOver) {
    const seconds = ((finalMs ?? elapsedMs) / 1000).toFixed(1);
    const fmt = (ms) => (ms / 1000).toFixed(1);

    // Compare this run to the best time before it (settled once `leaderboard`
    // is built). Round to a tenth so the message matches the displayed times.
    let verdict = null;
    if (won && finalMs != null && leaderboard) {
      if (prevBest == null) {
        verdict = `Your very first ${baseNumber}× crossing — this is the time to beat! 🚩`;
      } else if (Math.round(finalMs / 100) < Math.round(prevBest / 100)) {
        verdict = `🎉 New record! You beat your old best of ${fmt(prevBest)}s!`;
      } else if (Math.round(finalMs / 100) === Math.round(prevBest / 100)) {
        verdict = `So close — you tied your best of ${fmt(prevBest)}s!`;
      } else {
        verdict = `Your best is still ${fmt(prevBest)}s — try again to beat it!`;
      }
    }

    return (
      <div className={styles.container}>
        <div className={styles.gameOverScreen}>
          {won ? (
            <>
              <div className={styles.gameOverIcon}>💎</div>
              <h2 className={styles.gameOverTitle}>You crossed the river!</h2>
              <div className={styles.timeLabel}>You crossed the {baseNumber}× stones in</div>
              <div className={styles.bigTime}>
                <span className={styles.bigTimeNum}>{seconds}</span>
                <span className={styles.bigTimeUnit}>s</span>
              </div>
              {restarts > 0 && (
                <div className={styles.restartNote}>
                  with {restarts} restart{restarts > 1 ? 's' : ''} along the way
                </div>
              )}
              {verdict && <div className={styles.verdict}>{verdict}</div>}

              {leaderboard && (
                <div className={styles.leaderboard}>
                  <div className={styles.leaderboardTitle}>
                    🏆 Best {baseNumber}× times
                  </div>
                  {leaderboard.map((entry, i) => (
                    <div
                      key={i}
                      className={`${styles.leaderboardRow} ${
                        entry.current ? styles.leaderboardRowCurrent : ''
                      }`}
                    >
                      <span className={styles.leaderboardRank}>{i + 1}</span>
                      <span className={styles.leaderboardTime}>{fmt(entry.ms)}s</span>
                      {entry.current && (
                        <span className={styles.leaderboardYou}>← this run</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.gameOverIcon}>🌊</div>
              <h2 className={styles.gameOverTitle}>The river swept you back!</h2>
              <div className={styles.gameOverScore}>
                You made it {currentIndex} stones across
              </div>
            </>
          )}
          <button className={styles.restartButton} onClick={() => onComplete?.()}>
            Back to the Lair
          </button>
        </div>
      </div>
    );
  }

  const showChoices = !busy && targetStone;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${(currentIndex / NUM_STONES) * 100}%` }}
          />
        </div>
        <div className={styles.headerText}>
          {currentIndex}/{NUM_STONES} · ⏱ {(elapsedMs / 1000).toFixed(1)}s
        </div>
        <button
          className={styles.quitButton}
          onClick={() => setShowQuitConfirm(true)}
          aria-label="Quit game"
        >
          ← Quit
        </button>
      </div>

      <div className={styles.gameTitle}>Choose the next multiple of {baseNumber}</div>

      <div className={styles.stream} ref={streamRef}>
        <div className={styles.leftBank}>
          <span className={styles.bankLabel}>🌿 Near Bank</span>
        </div>
        <div className={styles.rightBank}>
          <span className={styles.bankLabel}>Far Bank 🌿</span>
        </div>

        {/* The zig-zag path of rocks. Landed/stamped rocks show their number;
            the next rock shows a "?" and is ringed by the answer choices. */}
        {path.map((pos, i) => {
          const landed = i < currentIndex;
          const isStamping = stamping?.index === i;
          const isTarget = showChoices && i === currentIndex;
          const value = landed ? hops[i].target : isStamping ? stamping.value : null;
          return (
            <div
              key={i}
              className={`${styles.rock} ${value != null ? styles.rockNumbered : ''} ${
                isTarget ? styles.rockTarget : ''
              }`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              {isStamping && <div className={styles.splash} />}
              {value != null ? (
                <span className={styles.number}>{value}</span>
              ) : isTarget ? (
                <span className={styles.questionMark}>?</span>
              ) : null}
            </div>
          );
        })}

        {/* Answer choices, ringing the target rock at equal distance. */}
        {showChoices &&
          hops[currentIndex].choices.map((choice, idx) => {
            const slot = padPositions[idx] ?? targetStone;
            return (
              <button
                key={`${currentIndex}-${idx}-${restarts}`}
                className={styles.choicePad}
                style={{
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                }}
                onClick={() => handleStoneClick(choice, slot)}
                aria-label={`Lily pad with ${choice.value}`}
              >
                <span className={styles.number}>{choice.value}</span>
              </button>
            );
          })}

        {/* The plunge splash where the otter drops into the water. */}
        {plungeAt && (
          <div
            className={styles.plunge}
            style={{ left: `${plungeAt.x}%`, top: `${plungeAt.y}%` }}
          >
            <div className={styles.ripple} />
            <div className={styles.splashCrown} />
            {SPLASH_DROPLETS.map((d, i) => (
              <span
                key={i}
                className={styles.droplet}
                style={{
                  '--tx': `${d.tx}px`,
                  '--ty': `${d.ty}px`,
                  animationDelay: `${d.delay}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* The otter — transitions between rock positions to "hop". */}
        <div
          key={otterKey}
          className={`${styles.otter} ${otterHopping ? styles.otterHopping : ''} ${
            otterSinking ? styles.otterSinking : ''
          }`}
          style={{ left: `${otterDisplayPos.x}%`, top: `${otterDisplayPos.y}%` }}
          aria-hidden
        >
          <span className={styles.otterGlyph}>🦦</span>
        </div>

        {showReset && (
          <div className={styles.resetBanner}>🌊 Oops! Back to the start!</div>
        )}
      </div>

      {streak > 0 && <div className={styles.streakDisplay}>🔥 {streak} in a row!</div>}

      <div className={styles.instructions}>
        Tap the next number in the {baseNumber}× count: {baseNumber}, {baseNumber * 2},{' '}
        {baseNumber * 3}…
      </div>

      {showQuitConfirm && (
        <div className={styles.quitModal}>
          <div className={styles.quitModalContent}>
            <p>Are you sure you want to go back?</p>
            <div className={styles.quitModalButtons}>
              <button className={styles.quitConfirmBtn} onClick={() => onComplete?.()}>
                Yes, back to the Lair
              </button>
              <button
                className={styles.quitCancelBtn}
                onClick={() => setShowQuitConfirm(false)}
              >
                Keep crossing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
