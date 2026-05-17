import { useCallback, useEffect, useRef, useState } from 'react';
import {
  battleConfigFromServer,
  buildGrid,
  DEFAULT_GRID_SIZE,
  generateProblem,
  getDefaultBattleConfig,
  PROBLEMS_TO_WIN,
} from '../data/battleData';
import { MAP_NODES, NODE_TYPE } from '../data/mapData';
import { api } from '../api';

// Keep BattlePage.module.css `.shuffleBarFill` animation duration in sync with this.
const GRID_SHUFFLE_MS = 3000;
// Cells go blank for this long before the next grid appears.
const GRID_BLANK_MS = 500;
const LOG_FLUSH_MS = 5000;

export function useBattle(nodeId) {
  const isBoss = MAP_NODES.find(n => n.id === nodeId)?.type === NODE_TYPE.BOSS;

  const [config, setConfig] = useState(() => getDefaultBattleConfig(nodeId));
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [problem, setProblem] = useState(() => generateProblem(config));
  const [grid, setGrid] = useState(() => buildGrid(problem.answer, config, DEFAULT_GRID_SIZE));
  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [blanking, setBlanking] = useState(false);
  const [status, setStatus] = useState('playing'); // 'playing' | 'won' | 'lost'

  // Bond Power (companion ability) state. Single ability kind for now: hint2x2
  // highlights a 2x2 grid region containing the correct answer for `durationMs`.
  const [hintCellIndices, setHintCellIndices] = useState(null);
  const [hintColor, setHintColor] = useState(null);
  const [bondCooldownMs, setBondCooldownMs] = useState(0);
  const [bondCooldownTotalMs, setBondCooldownTotalMs] = useState(0);
  // Bumped each time a bond power fires; the shuffle effect reads this so the
  // next shuffle is rescheduled *after* the hint completes.
  const [shuffleResetToken, setShuffleResetToken] = useState(0);
  const shuffleDeferMsRef = useRef(0);

  const configRef = useRef(config);
  configRef.current = config;
  const problemRef = useRef(problem);
  problemRef.current = problem;
  const gridSizeRef = useRef(gridSize);
  gridSizeRef.current = gridSize;

  // Timestamp (ms) when the current problem appeared. Reset whenever we swap
  // in a new problem; AI ticks do NOT reset it, so a second AI tick on the
  // same problem records a longer elapsed time (the child fell further behind).
  const problemStartedAtRef = useRef(Date.now());
  // Queues for batched logging; flushed every LOG_FLUSH_MS and on unmount.
  const pendingAttemptsRef = useRef([]);
  const pendingWrongTapsRef = useRef([]);

  const flushLogs = useCallback(() => {
    const attempts = pendingAttemptsRef.current;
    const wrongTaps = pendingWrongTapsRef.current;
    if (attempts.length === 0 && wrongTaps.length === 0) return;
    pendingAttemptsRef.current = [];
    pendingWrongTapsRef.current = [];
    api.post('/api/attempts', { attempts, wrongTaps }).catch(() => { /* analytics: don't surface */ });
  }, []);

  // Load this node's full battle config from the server (ops, range, ai
  // speed, grid size). The grid rebuilds on the next shuffle tick or correct
  // tap; we also regenerate immediately so the UI reflects new values quickly.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/node-config')
      .then(({ configs }) => {
        if (cancelled) return;
        const row = configs.find(c => c.node_id === nodeId);
        if (!row) return;

        const nextConfig = battleConfigFromServer(row, nodeId);
        const nextSize = row.grid_size || DEFAULT_GRID_SIZE;
        const fresh = generateProblem(nextConfig);

        setConfig(nextConfig);
        setGridSize(nextSize);
        setProblem(fresh);
        setGrid(buildGrid(fresh.answer, nextConfig, nextSize));
        problemStartedAtRef.current = Date.now();
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, [nodeId]);

  // Advance to a new problem + grid (called after a correct tap)
  const nextProblem = useCallback(() => {
    const next = generateProblem(configRef.current);
    setProblem(next);
    setGrid(buildGrid(next.answer, configRef.current, gridSizeRef.current));
    problemStartedAtRef.current = Date.now();
  }, []);

  // Player taps a cell
  const handleCellTap = useCallback((cellIndex) => {
    if (status !== 'playing' || blanking) return;
    const value = grid[cellIndex];
    const now = Date.now();
    const timeMs = now - problemStartedAtRef.current;
    const p = problem;
    if (value === p.answer) {
      pendingAttemptsRef.current.push({
        node_id: nodeId,
        operand_a: p.a,
        operand_b: p.b,
        operator: p.op,
        answer: p.answer,
        outcome: 'child',
        time_ms: timeMs,
      });
      setPlayerScore(s => {
        const next = s + 1;
        if (next >= PROBLEMS_TO_WIN) setStatus('won');
        return next;
      });
      nextProblem();
    } else {
      pendingWrongTapsRef.current.push({
        node_id: nodeId,
        operand_a: p.a,
        operand_b: p.b,
        operator: p.op,
        correct_answer: p.answer,
        tapped_value: value,
        time_ms: timeMs,
      });
      setWrongCellIndex(cellIndex);
      setTimeout(() => setWrongCellIndex(null), 350);
    }
  }, [grid, problem, status, blanking, nodeId, nextProblem]);

  // AI scores on a timer with some jitter
  useEffect(() => {
    if (status !== 'playing') return;
    const base = config.aiSeconds * 1000;
    const jitter = base * 0.35 * (Math.random() - 0.5); // ±17.5%
    const delay = Math.max(1500, base + jitter);

    const timer = setTimeout(() => {
      const p = problemRef.current;
      pendingAttemptsRef.current.push({
        node_id: nodeId,
        operand_a: p.a,
        operand_b: p.b,
        operator: p.op,
        answer: p.answer,
        outcome: 'ai',
        time_ms: Date.now() - problemStartedAtRef.current,
      });
      setAiScore(s => {
        const next = s + 1;
        if (next >= PROBLEMS_TO_WIN) setStatus('lost');
        return next;
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [aiScore, status, config.aiSeconds, nodeId]);

  // Periodic grid shuffle (numbers visible ~3s, blank ~1s, then a new grid).
  // When a bond hint is active we defer the next shuffle until after it ends
  // so the highlighted 2x2 region stays valid for the full hint duration.
  useEffect(() => {
    if (status !== 'playing') return;
    const deferMs = shuffleDeferMsRef.current;
    shuffleDeferMsRef.current = 0;
    let interval;
    const blankTimers = new Set();
    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        setBlanking(true);
        const t = setTimeout(() => {
          setGrid(buildGrid(problemRef.current.answer, configRef.current, gridSizeRef.current));
          setBlanking(false);
          blankTimers.delete(t);
        }, GRID_BLANK_MS);
        blankTimers.add(t);
      }, GRID_SHUFFLE_MS + GRID_BLANK_MS);
    }, deferMs);
    return () => {
      clearTimeout(startTimer);
      if (interval) clearInterval(interval);
      blankTimers.forEach(clearTimeout);
      setBlanking(false);
    };
  }, [status, shuffleResetToken]);

  // Bond cooldown ticker. Decrements every 100ms until 0.
  useEffect(() => {
    if (bondCooldownMs <= 0) return;
    const tick = setInterval(() => {
      setBondCooldownMs(prev => Math.max(0, prev - 100));
    }, 100);
    return () => clearInterval(tick);
  }, [bondCooldownMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger a Bond Power. No-op if a hint is already active or we're on cooldown.
  const triggerBondPower = useCallback((companion) => {
    if (!companion || status !== 'playing') return;
    if (bondCooldownMs > 0 || hintCellIndices !== null) return;
    const bp = companion.bondPower;
    if (!bp || bp.kind !== 'hint2x2') return;

    const size = gridSizeRef.current;
    const correctIdx = grid.findIndex(v => v === problem.answer);
    if (correctIdx < 0) return;
    const row = Math.floor(correctIdx / size);
    const col = correctIdx % size;

    // Valid top-left corners for a 2x2 window containing (row, col).
    const candidates = [];
    for (const r of [row - 1, row]) {
      for (const c of [col - 1, col]) {
        if (r >= 0 && r <= size - 2 && c >= 0 && c <= size - 2) {
          candidates.push([r, c]);
        }
      }
    }
    const [r0, c0] = candidates[Math.floor(Math.random() * candidates.length)];
    const indices = [
      r0 * size + c0,
      r0 * size + c0 + 1,
      (r0 + 1) * size + c0,
      (r0 + 1) * size + c0 + 1,
    ];

    setHintCellIndices(indices);
    setHintColor(bp.highlightColor);

    // Defer next shuffle past the end of the hint (+100ms breathing room).
    shuffleDeferMsRef.current = bp.durationMs + 100;
    setShuffleResetToken(t => t + 1);

    setTimeout(() => {
      setHintCellIndices(null);
      setHintColor(null);
    }, bp.durationMs);

    setBondCooldownTotalMs(bp.cooldownMs);
    setBondCooldownMs(bp.cooldownMs);
  }, [grid, problem, status, bondCooldownMs, hintCellIndices]);

  // Clear any active hint / cooldown when battle ends.
  useEffect(() => {
    if (status !== 'playing') {
      setHintCellIndices(null);
      setHintColor(null);
      setBondCooldownMs(0);
    }
  }, [status]);

  // Periodic + lifecycle flush of queued log events.
  useEffect(() => {
    const interval = setInterval(flushLogs, LOG_FLUSH_MS);
    return () => {
      clearInterval(interval);
      flushLogs();
    };
  }, [flushLogs]);

  // Flush immediately whenever a battle ends so the win/loss is logged promptly.
  useEffect(() => {
    if (status !== 'playing') flushLogs();
  }, [status, flushLogs]);

  // Reset for retry
  const reset = useCallback(() => {
    const fresh = generateProblem(configRef.current);
    setProblem(fresh);
    setGrid(buildGrid(fresh.answer, configRef.current, gridSizeRef.current));
    setPlayerScore(0);
    setAiScore(0);
    setStatus('playing');
    setWrongCellIndex(null);
    setBlanking(false);
    setHintCellIndices(null);
    setHintColor(null);
    setBondCooldownMs(0);
    setBondCooldownTotalMs(0);
    problemStartedAtRef.current = Date.now();
  }, []);

  return {
    problem,
    grid,
    gridSize,
    playerScore,
    aiScore,
    wrongCellIndex,
    blanking,
    status,
    isBoss,
    target: PROBLEMS_TO_WIN,
    handleCellTap,
    reset,
    // Bond Power
    hintCellIndices,
    hintColor,
    bondCooldownMs,
    bondCooldownTotalMs,
    triggerBondPower,
  };
}
