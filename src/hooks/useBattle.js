import { useCallback, useEffect, useRef, useState } from 'react';
import {
  battleConfigFromServer,
  buildGridFromLayout,
  generateProblem,
  getBattleLayout,
  getDefaultBattleConfig,
  getLayoutForShape,
  PROBLEMS_TO_WIN,
} from '../data/battleData';
import { MAP_NODES, NODE_TYPE, WORLDS } from '../data/mapData';
import { api } from '../api';
import { playGrowl, playYip } from '../utils/sounds';

// Cells go blank for this long between problems before the next grid appears.
const GRID_BLANK_MS = 500;
// Slightly longer pause when the AI solves it so the "grab the answer" beat
// has room to play before the next problem swaps in.
const GRID_BLANK_MS_AI = 850;
const LOG_FLUSH_MS = 5000;

export function useBattle(nodeId) {
  const isBoss = MAP_NODES.find(n => n.id === nodeId)?.type === NODE_TYPE.BOSS;

  const worldId = WORLDS.find(w => nodeId >= w.nodeRange[0] && nodeId <= w.nodeRange[1])?.id ?? 1;
  // Initial layout is the per-world fallback; replaced by the shape from
  // node_config.shape_id as soon as /api/node-config resolves.
  const [layout, setLayout] = useState(() => getBattleLayout(worldId));

  const [config, setConfig] = useState(() => getDefaultBattleConfig(nodeId));
  const [problem, setProblem] = useState(() => generateProblem(config));
  const [grid, setGrid] = useState(() => buildGridFromLayout(problem.answer, config, layout));
  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [blanking, setBlanking] = useState(false);
  // When the AI beats the player to the answer we briefly reveal it (and the
  // foe's icon "grabs" it). Cleared when the next problem swaps in.
  const [aiSolvedAnswer, setAiSolvedAnswer] = useState(null);
  const [status, setStatus] = useState('playing'); // 'playing' | 'won' | 'lost'
  // Total match duration in ms, set when the match ends. Shown on the victory screen.
  const [matchDurationMs, setMatchDurationMs] = useState(null);
  const matchStartedAtRef = useRef(Date.now());

  // Bond Power (companion ability) state. Each kind owns its own visible state:
  //   hint2x2         — hintCellIndices/hintColor: 2x2 region highlight
  //   mushroomGrove   — mushroomCellIndices: wrong cells covered until next problem
  //   lightningStrike — zappedCellIndices:   wrong cells removed until next problem
  //   aiLockout       — aiLocked: pauses the AI timer entirely for durationMs
  const [hintCellIndices, setHintCellIndices] = useState(null);
  const [hintColor, setHintColor] = useState(null);
  const [mushroomCellIndices, setMushroomCellIndices] = useState(null);
  const [zappedCellIndices, setZappedCellIndices] = useState(null);
  const [aiLocked, setAiLocked] = useState(false);
  const [bondCooldownMs, setBondCooldownMs] = useState(0);
  const [bondCooldownTotalMs, setBondCooldownTotalMs] = useState(0);

  const configRef = useRef(config);
  configRef.current = config;
  const problemRef = useRef(problem);
  problemRef.current = problem;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Timestamp (ms) when the current problem appeared. Reset whenever we swap
  // in a new problem; AI ticks do NOT reset it, so a second AI tick on the
  // same problem records a longer elapsed time (the child fell further behind).
  const problemStartedAtRef = useRef(Date.now());
  // Queues for batched logging; flushed every LOG_FLUSH_MS and on unmount.
  const pendingAttemptsRef = useRef([]);
  const pendingWrongTapsRef = useRef([]);

  // Server-assigned match id for the *currently open* battle. Cleared as soon
  // as we finalize it (win/loss/incomplete) so cleanup doesn't double-end it.
  const matchIdRef = useRef(null);
  // Latest scores mirrored into refs so the unmount cleanup — which runs after
  // React has torn down state — can read final scores when reporting incomplete.
  const playerScoreRef = useRef(0);
  const aiScoreRef = useRef(0);
  playerScoreRef.current = playerScore;
  aiScoreRef.current = aiScore;

  const startMatch = useCallback(() => {
    api.post('/api/matches', { node_id: nodeId })
      .then(({ id }) => { matchIdRef.current = id; })
      .catch(() => { /* analytics: don't surface */ });
  }, [nodeId]);

  const endMatch = useCallback((outcome) => {
    const id = matchIdRef.current;
    if (!id) return;
    matchIdRef.current = null;
    api.post(`/api/matches/${id}/end`, {
      outcome,
      player_score: playerScoreRef.current,
      ai_score: aiScoreRef.current,
    }).catch(() => { /* analytics: don't surface */ });
  }, []);

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
        const nextLayout = getLayoutForShape(nextConfig.shapeId, worldId);
        const fresh = generateProblem(nextConfig);

        setConfig(nextConfig);
        setLayout(nextLayout);
        setProblem(fresh);
        setGrid(buildGridFromLayout(fresh.answer, nextConfig, nextLayout));
        problemStartedAtRef.current = Date.now();
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, [nodeId, worldId]);

  // End the current problem (player got it right, or the AI's timer fired).
  // Blanks the grid for GRID_BLANK_MS, then swaps in a fresh problem + grid.
  // The match-end check happens here too; the result modal will cover the
  // grid before the swap reveals anything, so we always run the swap.
  const endProblem = useCallback((winner) => {
    if (winner === 'player') {
      setPlayerScore(s => {
        const next = s + 1;
        if (next >= PROBLEMS_TO_WIN) setStatus('won');
        return next;
      });
    } else {
      setAiScore(s => {
        const next = s + 1;
        if (next >= PROBLEMS_TO_WIN) setStatus('lost');
        return next;
      });
      setAiSolvedAnswer(problemRef.current.answer);
    }
    setBlanking(true);
    // Per-problem bond effects (mushrooms, zapped cells) clear when the next
    // problem swaps in. Indices are tied to the old grid, so they'd point at
    // the wrong cells otherwise.
    setMushroomCellIndices(null);
    setZappedCellIndices(null);
    const blankMs = winner === 'ai' ? GRID_BLANK_MS_AI : GRID_BLANK_MS;
    setTimeout(() => {
      const next = generateProblem(configRef.current);
      setProblem(next);
      setGrid(buildGridFromLayout(next.answer, configRef.current, layoutRef.current));
      problemStartedAtRef.current = Date.now();
      setBlanking(false);
      setAiSolvedAnswer(null);
    }, blankMs);
  }, []);

  // Player taps a cell
  const handleCellTap = useCallback((cellIndex) => {
    if (status !== 'playing' || blanking) return;
    // Mushroom-covered and lightning-zapped cells are inert: no answer match,
    // no wrong-tap penalty. The button is also disabled in BattlePage, but
    // belt-and-braces here keeps the rule near the scoring logic.
    if (mushroomCellIndices?.includes(cellIndex)) return;
    if (zappedCellIndices?.includes(cellIndex)) return;
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
      playYip();
      endProblem('player');
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
  }, [grid, problem, status, blanking, mushroomCellIndices, zappedCellIndices, nodeId, endProblem]);

  // AI tries to solve the current problem on a timer with some jitter. The
  // timer is anchored to `problem` (and pauses while blanking), so each new
  // problem gets a fresh attempt window — the AI can't "carry over" time.
  // When Sunfire's aiLockout fires, `aiLocked` flips true and the effect
  // bails — clearing the in-flight timer. When the lockout ends, the effect
  // re-runs and the AI gets a *fresh* full delay.
  useEffect(() => {
    if (status !== 'playing' || blanking || aiLocked) return;
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
      playGrowl();
      endProblem('ai');
    }, delay);

    return () => clearTimeout(timer);
  }, [problem, status, blanking, aiLocked, config.aiSeconds, nodeId, endProblem]);

  // Bond cooldown ticker. Decrements every 100ms until 0.
  useEffect(() => {
    if (bondCooldownMs <= 0) return;
    const tick = setInterval(() => {
      setBondCooldownMs(prev => Math.max(0, prev - 100));
    }, 100);
    return () => clearInterval(tick);
  }, [bondCooldownMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const bondActive =
    hintCellIndices !== null ||
    mushroomCellIndices !== null ||
    zappedCellIndices !== null ||
    aiLocked;

  // Trigger a Bond Power. No-op if any ability is already active or we're on cooldown.
  const triggerBondPower = useCallback((companion) => {
    if (!companion || status !== 'playing' || blanking) return;
    if (bondCooldownMs > 0 || bondActive) return;
    const bp = companion.bondPower;
    if (!bp) return;

    const { cols, rows } = layoutRef.current;

    // Active-cell indices that are *wrong* answers (skip spacers and the answer cell).
    const wrongIndices = grid.reduce((acc, v, i) => {
      if (v !== null && v !== problem.answer) acc.push(i);
      return acc;
    }, []);

    if (bp.kind === 'hint2x2') {
      // Enumerate every 2x2 window with ≥3 active cells, then prefer ones
      // that contain the answer. On sparse layouts where no answer-containing
      // 2x2 catches 3 cells, fall back to any 3+ cell window so the player
      // still sees a meaningful highlight (just not the answer).
      const windows = [];
      for (let r = 0; r <= rows - 2; r++) {
        for (let c = 0; c <= cols - 2; c++) {
          const idxs = [
            r * cols + c,
            r * cols + c + 1,
            (r + 1) * cols + c,
            (r + 1) * cols + c + 1,
          ];
          const active = idxs.filter(idx => grid[idx] !== null);
          if (active.length < 3) continue;
          const containsAnswer = active.some(idx => grid[idx] === problem.answer);
          windows.push({ active, containsAnswer });
        }
      }
      const withAnswer = windows.filter(w => w.containsAnswer);
      const pool = withAnswer.length > 0 ? withAnswer : windows;
      if (pool.length === 0) return;
      const chosen = pool[Math.floor(Math.random() * pool.length)];

      setHintCellIndices(chosen.active);
      setHintColor(bp.highlightColor);
      setTimeout(() => {
        setHintCellIndices(null);
        setHintColor(null);
      }, bp.durationMs);
    } else if (bp.kind === 'mushroomGrove') {
      // Cover roughly half of the wrong cells. Shuffle then take half.
      const shuffled = [...wrongIndices].sort(() => Math.random() - 0.5);
      const coverCount = Math.ceil(shuffled.length / 2);
      setMushroomCellIndices(shuffled.slice(0, coverCount));
      // Clears at next problem swap (see endProblem).
    } else if (bp.kind === 'lightningStrike') {
      // Zap up to 4 wrong cells (or all of them if fewer than 4 exist).
      const shuffled = [...wrongIndices].sort(() => Math.random() - 0.5);
      const zapCount = Math.min(4, shuffled.length);
      setZappedCellIndices(shuffled.slice(0, zapCount));
      // Clears at next problem swap (see endProblem).
    } else if (bp.kind === 'aiLockout') {
      setAiLocked(true);
      setTimeout(() => setAiLocked(false), bp.durationMs);
    } else {
      return;
    }

    setBondCooldownTotalMs(bp.cooldownMs);
    setBondCooldownMs(bp.cooldownMs);
  }, [grid, problem, status, blanking, bondCooldownMs, bondActive]);

  // Clear any active bond effects / cooldown when battle ends, and stamp the final duration.
  useEffect(() => {
    if (status !== 'playing') {
      setHintCellIndices(null);
      setHintColor(null);
      setMushroomCellIndices(null);
      setZappedCellIndices(null);
      setAiLocked(false);
      setBondCooldownMs(0);
      setMatchDurationMs(Date.now() - matchStartedAtRef.current);
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

  // Open a match row when the battle mounts; mark it incomplete if the player
  // leaves before reaching the target. `nodeId` is stable for the lifetime of
  // this hook (BattlePage keys remount on node change), so this fires once.
  useEffect(() => {
    startMatch();
    return () => { endMatch('incomplete'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finalize the match as soon as someone reaches the target.
  useEffect(() => {
    if (status === 'won')  endMatch('child');
    if (status === 'lost') endMatch('ai');
  }, [status, endMatch]);

  // Reset for retry
  const reset = useCallback(() => {
    const fresh = generateProblem(configRef.current);
    setProblem(fresh);
    setGrid(buildGridFromLayout(fresh.answer, configRef.current, layoutRef.current));
    setPlayerScore(0);
    setAiScore(0);
    setStatus('playing');
    setWrongCellIndex(null);
    setBlanking(false);
    setHintCellIndices(null);
    setHintColor(null);
    setMushroomCellIndices(null);
    setZappedCellIndices(null);
    setAiLocked(false);
    setBondCooldownMs(0);
    setBondCooldownTotalMs(0);
    setMatchDurationMs(null);
    matchStartedAtRef.current = Date.now();
    problemStartedAtRef.current = Date.now();
    // Retry counts as a fresh match. If the prior match wasn't already ended
    // (defensive — Retry is only reachable from the loss modal), close it
    // first so we don't leave a stranded open row.
    if (matchIdRef.current) endMatch('incomplete');
    startMatch();
  }, [endMatch, startMatch]);

  return {
    problem,
    grid,
    layoutCols: layout.cols,
    layoutRows: layout.rows,
    playerScore,
    aiScore,
    wrongCellIndex,
    blanking,
    aiSolvedAnswer,
    status,
    isBoss,
    target: PROBLEMS_TO_WIN,
    matchDurationMs,
    handleCellTap,
    reset,
    // Bond Power
    hintCellIndices,
    hintColor,
    mushroomCellIndices,
    zappedCellIndices,
    aiLocked,
    bondActive,
    bondCooldownMs,
    bondCooldownTotalMs,
    triggerBondPower,
  };
}
