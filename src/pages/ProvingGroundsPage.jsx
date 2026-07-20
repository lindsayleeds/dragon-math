import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthContext } from '../contexts/AuthContext';
import { usePlaytimeHeartbeat } from '../hooks/usePlaytimeHeartbeat';
import {
  DIGITS,
  MODES,
  MODE_BY_KEY,
  MEDALS,
  THRESHOLDS,
  buildProblemSet,
  awardMedal,
  loadMedals,
  bestMedal,
  recordMedal,
} from '../utils/provingGrounds';
import styles from '../styles/ProvingGrounds.module.css';

// Screens: choose mode → choose digit → play the drill → results.
const SCREEN = { MODE: 'mode', LEVEL: 'level', PLAY: 'play', RESULT: 'result' };

const NUMPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'del', '0', 'ok'];

const CORRECTION_MS = 2000; // how long the "here's the right answer" modal lingers
const WRONG_LIMIT = 2; // a second miss ends the run — no medal is possible past one slip

function formatTime(sec) {
  return `${sec.toFixed(1)}s`;
}

export function ProvingGroundsPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  usePlaytimeHeartbeat(true);

  const [screen, setScreen] = useState(SCREEN.MODE);
  const [mode, setMode] = useState(null);
  const [digit, setDigit] = useState(null);
  const [medals, setMedals] = useState(() => loadMedals(user?.id));

  // ----- live drill state -----
  const [problems, setProblems] = useState([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [wrongCount, setWrongCount] = useState(0);
  const [flash, setFlash] = useState(null); // {kind, id} — transient right/wrong pulse
  const [correction, setCorrection] = useState(null); // {prompt, answer} — miss modal
  const [now, setNow] = useState(0); // live clock tick for the timer readout
  const startRef = useRef(0);
  const attemptsRef = useRef([]);
  const flashIdRef = useRef(0);
  const advanceTimerRef = useRef(null);

  // ----- result state -----
  const [result, setResult] = useState(null); // { elapsed, wrongCount, medal, isBest }

  const startLevel = (m, d) => {
    clearTimeout(advanceTimerRef.current);
    setMode(m);
    setDigit(d);
    setProblems(buildProblemSet(m, d));
    setIndex(0);
    setInput('');
    setWrongCount(0);
    setFlash(null);
    setCorrection(null);
    attemptsRef.current = [];
    startRef.current = performance.now();
    setNow(startRef.current);
    setScreen(SCREEN.PLAY);
  };

  // Tick the on-screen timer a few times a second while playing.
  useEffect(() => {
    if (screen !== SCREEN.PLAY) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [screen]);

  const finish = useCallback((finalWrong) => {
    const elapsed = (performance.now() - startRef.current) / 1000;
    const medal = awardMedal(elapsed, finalWrong);
    const { medals: nextMedals, isBest } = recordMedal(user?.id, mode, digit, medal);
    setMedals(nextMedals);
    setResult({ elapsed, wrongCount: finalWrong, medal, isBest });
    // Log every problem for mastery tracking (node_id 0 = not a map battle).
    const attempts = attemptsRef.current;
    if (attempts.length) {
      api.post('/api/attempts', { attempts }).catch(() => { /* analytics: don't surface */ });
    }
    setScreen(SCREEN.RESULT);
  }, [user?.id, mode, digit]);

  const submit = useCallback(() => {
    if (screen !== SCREEN.PLAY || correction || input === '') return;
    const prob = problems[index];
    const correct = Number(input) === prob.answer;
    const isLast = index + 1 >= problems.length;

    attemptsRef.current.push({
      node_id: 0,
      operand_a: prob.a,
      operand_b: prob.b,
      operator: prob.op,
      answer: prob.answer,
      outcome: correct ? 'child' : 'ai',
    });
    setInput('');

    if (correct) {
      flashIdRef.current += 1;
      setFlash({ kind: 'right', id: flashIdRef.current });
      if (isLast) finish(wrongCount);
      else setIndex(index + 1);
      return;
    }

    // Miss — hold on the correct answer for a beat, then move on. The clock
    // keeps running, so a slip costs a little time (only bronze allows one).
    // A second miss ends the run right after the modal.
    const nextWrong = wrongCount + 1;
    setWrongCount(nextWrong);
    const ended = nextWrong >= WRONG_LIMIT;
    setCorrection({ prompt: prob.prompt, answer: prob.answer });
    advanceTimerRef.current = setTimeout(() => {
      setCorrection(null);
      if (ended || isLast) finish(nextWrong);
      else setIndex(index + 1);
    }, CORRECTION_MS);
  }, [screen, correction, input, problems, index, wrongCount, finish]);

  const pressKey = useCallback((key) => {
    if (correction) return; // input frozen while the miss modal is up
    if (key === 'ok') return submit();
    if (key === 'del') return setInput((v) => v.slice(0, -1));
    // digit — cap at 3 chars (largest answer is 144).
    setInput((v) => (v.length >= 3 ? v : v + key));
  }, [submit, correction]);

  // Clear any pending advance timer if the page unmounts mid-modal.
  useEffect(() => () => clearTimeout(advanceTimerRef.current), []);

  // Hardware keyboard support during the drill.
  useEffect(() => {
    if (screen !== SCREEN.PLAY) return;
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') pressKey(e.key);
      else if (e.key === 'Backspace') pressKey('del');
      else if (e.key === 'Enter') pressKey('ok');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, pressKey]);

  const modeInfo = mode ? MODE_BY_KEY[mode] : null;
  const elapsedSec = Math.max(0, (now - startRef.current) / 1000);

  const onBack = () => {
    clearTimeout(advanceTimerRef.current);
    setCorrection(null);
    if (screen === SCREEN.MODE) navigate('/learning-lair');
    else if (screen === SCREEN.LEVEL) setScreen(SCREEN.MODE);
    else if (screen === SCREEN.PLAY) setScreen(SCREEN.LEVEL); // abandon this run
    else setScreen(SCREEN.LEVEL); // result → pick another level
  };

  const backLabel = screen === SCREEN.MODE ? '← learning lair'
    : screen === SCREEN.PLAY ? '← give up'
    : '← back';

  const subtitle =
    screen === SCREEN.MODE ? '— what will you prove today?'
    : screen === SCREEN.LEVEL ? `— pick a ${modeInfo?.label.toLowerCase()} challenge`
    : screen === SCREEN.PLAY ? `— ${modeInfo?.label.toLowerCase()} · the ${digit}s`
    : '— how did you do?';

  return (
    <div className={`${styles.page} ${screen === SCREEN.PLAY ? styles.playing : ''}`}>
      <header className={styles.header}>
        <div className={styles.washiTopStrip} />
        <button className={styles.backTab} onClick={onBack}>{backLabel}</button>
        <div className={styles.titleWrap}>
          <span className={styles.titleIcon} aria-hidden>🏆</span>
          <h1 className={styles.title}>Proving Grounds</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </header>

      <main className={styles.main}>
        {screen === SCREEN.MODE && (
          <ModeScreen onPick={(m) => { setMode(m); setScreen(SCREEN.LEVEL); }} />
        )}

        {screen === SCREEN.LEVEL && modeInfo && (
          <LevelScreen mode={mode} modeInfo={modeInfo} medals={medals} onPick={startLevel} />
        )}

        {screen === SCREEN.PLAY && (
          <PlayScreen
            modeInfo={modeInfo}
            problem={problems[index]}
            index={index}
            total={problems.length}
            input={input}
            wrongCount={wrongCount}
            elapsedSec={elapsedSec}
            flash={flash}
            onPress={pressKey}
          />
        )}

        {screen === SCREEN.RESULT && result && (
          <ResultScreen
            result={result}
            modeInfo={modeInfo}
            digit={digit}
            onRetry={() => startLevel(mode, digit)}
            onPickLevel={() => setScreen(SCREEN.LEVEL)}
          />
        )}
      </main>

      {correction && (
        <div className={styles.correctionOverlay} role="alertdialog" aria-live="assertive">
          <div className={styles.correctionCard} style={{ '--accent': modeInfo?.color }}>
            <span className={styles.correctionLabel}>Not quite!</span>
            <span className={styles.correctionProblem}>
              {correction.prompt} = <b>{correction.answer}</b>
            </span>
            <span className={styles.correctionHint}>remember this one!</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeScreen({ onPick }) {
  return (
    <>
      <p className={styles.blurbLine}>
        Answer every fact twice, as fast as you can. Earn 🥉 🥈 🥇 for your speed!
      </p>
      <div className={styles.modeGrid}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={styles.modeCard}
            style={{ '--accent': m.color }}
            onClick={() => onPick(m.key)}
            aria-label={`Prove your ${m.label} skills`}
          >
            <span className={styles.modeSymbol} aria-hidden>{m.symbol}</span>
            <span className={styles.modeLabel}>{m.label}</span>
            <span className={styles.modeBlurb}>{m.blurb}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function LevelScreen({ mode, modeInfo, medals, onPick }) {
  return (
    <>
      <div className={styles.digitGrid} style={{ '--accent': modeInfo.color }}>
        {DIGITS.map((d) => {
          const medal = bestMedal(medals, mode, d);
          return (
            <button
              key={d}
              type="button"
              className={styles.digitCard}
              onClick={() => onPick(mode, d)}
              aria-label={`The ${d}s${medal ? ` — best: ${MEDALS[medal].label}` : ''}`}
            >
              <span className={styles.digitFace}>
                <span className={styles.digitNum}>{d}</span>
                <span className={styles.digitOp} aria-hidden>{modeInfo.symbol}</span>
              </span>
              <span className={styles.digitLabel}>the {d}s</span>
              <span className={styles.digitMedal} aria-hidden>
                {medal ? MEDALS[medal].icon : '·'}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendTitle}>Beat the clock:</span>
        <span className={styles.legendItem}>{MEDALS.gold.icon} under {THRESHOLDS.gold}s · perfect</span>
        <span className={styles.legendItem}>{MEDALS.silver.icon} under {THRESHOLDS.silver}s · perfect</span>
        <span className={styles.legendItem}>{MEDALS.bronze.icon} under {THRESHOLDS.bronze}s · 1 slip ok</span>
      </div>
    </>
  );
}

function PlayScreen({ modeInfo, problem, index, total, input, wrongCount, elapsedSec, flash, onPress }) {
  const pct = Math.round((index / total) * 100);
  return (
    <div className={styles.play}>
      <div className={styles.playInfo}>
      <div className={styles.hud}>
        <span className={styles.hudTimer}>⏱ {formatTime(elapsedSec)}</span>
        <span className={styles.hudCount}>{index + 1} / {total}</span>
        <span className={styles.hudWrong} data-has={wrongCount > 0 ? 'yes' : 'no'}>
          ✗ {wrongCount}
        </span>
      </div>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${pct}%`, '--accent': modeInfo.color }} />
      </div>

      <div
        key={flash?.id}
        className={styles.problemCard}
        data-flash={flash?.kind || ''}
        style={{ '--accent': modeInfo.color }}
      >
        <span className={styles.problemText}>{problem.prompt}</span>
        <span className={styles.answerBox}>{input || ' '}</span>
      </div>
      </div>

      <div className={styles.numpad}>
        {NUMPAD_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={
              k === 'ok' ? `${styles.numKey} ${styles.numKeyOk}`
              : k === 'del' ? `${styles.numKey} ${styles.numKeyDel}`
              : styles.numKey
            }
            style={k === 'ok' ? { '--accent': modeInfo.color } : undefined}
            onClick={() => onPress(k)}
            aria-label={k === 'ok' ? 'Check answer' : k === 'del' ? 'Delete' : k}
          >
            {k === 'ok' ? '✓' : k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultScreen({ result, modeInfo, digit, onRetry, onPickLevel }) {
  const { elapsed, wrongCount, medal, isBest } = result;
  const medalInfo = medal ? MEDALS[medal] : null;

  return (
    <div className={styles.result}>
      <div className={styles.resultBadge} data-medal={medal || 'none'}>
        <span className={styles.resultIcon} aria-hidden>
          {medalInfo ? medalInfo.icon : '💪'}
        </span>
      </div>

      <h2 className={styles.resultHeading}>
        {medalInfo ? `${medalInfo.label} medal!` : 'Keep practicing!'}
      </h2>
      {isBest && medalInfo && <p className={styles.resultBest}>★ new personal best ★</p>}

      <p className={styles.resultLine}>
        {modeInfo.label} · the {digit}s
      </p>
      <div className={styles.resultStats}>
        <span className={styles.resultStat}><b>{formatTime(elapsed)}</b> time</span>
        <span className={styles.resultStat}><b>{wrongCount}</b> missed</span>
      </div>

      {!medalInfo && (
        <p className={styles.resultHint}>
          {wrongCount >= 2
            ? 'Two misses ends the run — one slip is the most you can make. Try again!'
            : `Finish under ${THRESHOLDS.bronze}s with one slip or fewer to earn a medal.`}
        </p>
      )}

      <div className={styles.resultBtns}>
        <button type="button" className={styles.primaryBtn} style={{ '--accent': modeInfo.color }} onClick={onRetry}>
          try again
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onPickLevel}>
          pick another
        </button>
      </div>
    </div>
  );
}
