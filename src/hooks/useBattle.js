import { useCallback, useEffect, useRef, useState } from 'react';
import {
  battleConfigFromServer,
  getBattleLayout,
  getDefaultBattleConfig,
  getLayoutForShape,
} from '../data/battleData';
import { battleSettingsFromServer } from '../data/battleSettings';
import { MAP_NODES, NODE_TYPE, worldForNode } from '../data/mapData';
import { api } from '../api';
import { playGrowl, playYip } from '../utils/sounds';
import { createBattleState, isBondActive, nextTimerAt, stepBattle } from '../rules/battle';

const LOG_FLUSH_MS = 5000;
const SOUNDS = { yip: playYip, growl: playGrowl };
// Read through a wrapper, not captured, so a test spying on Math.random still
// reaches every draw.
const random = () => Math.random();

// The battle's rules — timers, grid lock, opponent pace, first to 10, Bond
// Powers — live in the pure reducer in src/rules/battle.js. This hook only
// feeds it events (taps, the server config, the clock) and performs what it
// asks for: sounds, attempt logging, and the match row on the server.
export function useBattle(nodeId) {
  const isBoss = MAP_NODES.find(n => n.id === nodeId)?.type === NODE_TYPE.BOSS;

  const worldId = worldForNode(nodeId)?.id ?? 1;
  // Dealt from the per-node default config and per-world layout, with the
  // fallback tunables; replaced by the server's (and the shape from
  // node_config.shape_id) as soon as /api/rule-settings resolves.
  const [initial] = useState(() => createBattleState(
    { config: getDefaultBattleConfig(nodeId), layout: getBattleLayout(worldId) },
    random,
  ));
  // `battle` is what renders; `battleRef` is the same state, current even
  // before React re-renders, which is what the next event is stepped from.
  const [battle, setBattle] = useState(initial);
  const battleRef = useRef(initial);
  // One setTimeout, armed for the reducer's earliest deadline.
  const clockRef = useRef(null);

  // Queues for batched logging; flushed every LOG_FLUSH_MS and on unmount.
  const pendingAttemptsRef = useRef([]);
  const pendingWrongTapsRef = useRef([]);
  // Server-assigned match id for the *currently open* battle. Cleared as soon
  // as we finalize it (win/loss/incomplete) so cleanup doesn't double-end it.
  const matchIdRef = useRef(null);

  const dispatch = useCallback(function dispatch(event) {
    const { state, effects } = stepBattle(battleRef.current, event, random);
    battleRef.current = state;
    setBattle(state);
    for (const effect of effects) {
      if (effect.type === 'sound') SOUNDS[effect.sound]?.();
      else if (effect.type === 'attempt') pendingAttemptsRef.current.push({ node_id: nodeId, ...effect.attempt });
      else if (effect.type === 'wrongTap') pendingWrongTapsRef.current.push({ node_id: nodeId, ...effect.wrongTap });
    }
    // Re-arm here rather than in an effect, so a deadline reached while React
    // has not re-rendered yet (a burst of cooldown ticks) still fires on time.
    if (clockRef.current) clearTimeout(clockRef.current);
    clockRef.current = null;
    const at = nextTimerAt(state);
    if (at !== null) {
      clockRef.current = setTimeout(() => {
        clockRef.current = null;
        dispatch({ type: 'tick', now: Date.now() });
      }, Math.max(0, Math.ceil(at - Date.now())));
    }
  }, [nodeId]);

  const startMatch = useCallback(() => {
    api.post('/api/matches', { node_id: nodeId })
      .then(({ id }) => { matchIdRef.current = id; })
      .catch(() => { /* analytics: don't surface */ });
  }, [nodeId]);

  // Reads the reducer's latest scores, so the unmount cleanup — which runs
  // after React has torn down state — reports what the child actually reached.
  const endMatch = useCallback((outcome) => {
    const id = matchIdRef.current;
    if (!id) return;
    matchIdRef.current = null;
    api.post(`/api/matches/${id}/end`, {
      outcome,
      player_score: battleRef.current.playerScore,
      ai_score: battleRef.current.aiScore,
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

  // Start the clocks on mount; drop the pending deadline on unmount.
  useEffect(() => {
    dispatch({ type: 'start', now: Date.now() });
    return () => {
      if (clockRef.current) clearTimeout(clockRef.current);
      clockRef.current = null;
    };
  }, [dispatch]);

  // Load the rule settings: the game-wide battle tunables (opponent pace, grid
  // timings — see src/data/battleSettings.js) and this node's battle config
  // (ops, range, ai speed, grid shape), redealing from the latter straight
  // away. On failure every value keeps its fallback.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/rule-settings')
      .then((doc) => {
        if (cancelled) return;
        dispatch({ type: 'settingsLoaded', now: Date.now(), settings: battleSettingsFromServer(doc) });
        const row = (doc?.nodes ?? []).find(c => c.node_id === nodeId);
        if (!row) return;
        const config = battleConfigFromServer(row, nodeId);
        const layout = getLayoutForShape(config.shapeId, worldId);
        dispatch({ type: 'configLoaded', now: Date.now(), config, layout });
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, [nodeId, worldId, dispatch]);

  const handleCellTap = useCallback((cellIndex) => {
    dispatch({ type: 'tap', now: Date.now(), cell: cellIndex });
  }, [dispatch]);

  // Trigger a companion's Bond Power. The reducer refuses it while one is
  // active, on cooldown, or between problems.
  const triggerBondPower = useCallback((companion) => {
    if (!companion?.bondPower) return;
    dispatch({ type: 'bondPower', now: Date.now(), power: companion.bondPower });
  }, [dispatch]);

  // Periodic + lifecycle flush of queued log events.
  useEffect(() => {
    const interval = setInterval(flushLogs, LOG_FLUSH_MS);
    return () => {
      clearInterval(interval);
      flushLogs();
    };
  }, [flushLogs]);

  const { status } = battle;

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

  // Reset for retry. Retry counts as a fresh match. If the prior match wasn't
  // already ended (defensive — Retry is only reachable from the loss modal),
  // close it first, with its final scores, so we don't leave a stranded open row.
  const reset = useCallback(() => {
    if (matchIdRef.current) endMatch('incomplete');
    dispatch({ type: 'retry', now: Date.now() });
    startMatch();
  }, [dispatch, endMatch, startMatch]);

  return {
    problem: battle.problem,
    grid: battle.grid,
    layoutCols: battle.layout.cols,
    layoutRows: battle.layout.rows,
    playerScore: battle.playerScore,
    aiScore: battle.aiScore,
    wrongCellIndex: battle.wrongCellIndex,
    gridLocked: battle.gridLocked,
    blanking: battle.blanking,
    aiSolvedAnswer: battle.aiSolvedAnswer,
    aiEatCellIndex: battle.aiEatCellIndex,
    status,
    isBoss,
    target: battle.target,
    matchDurationMs: battle.matchDurationMs,
    handleCellTap,
    reset,
    // Bond Power
    hintCellIndices: battle.hintCellIndices,
    hintColor: battle.hintColor,
    revealCellIndex: battle.revealCellIndex,
    mushroomCellIndices: battle.mushroomCellIndices,
    zappedCellIndices: battle.zappedCellIndices,
    aiLocked: battle.aiLocked,
    shieldActive: battle.shieldActive,
    bondActive: isBondActive(battle),
    bondCooldownMs: battle.bondCooldownMs,
    bondCooldownTotalMs: battle.bondCooldownTotalMs,
    triggerBondPower,
  };
}
