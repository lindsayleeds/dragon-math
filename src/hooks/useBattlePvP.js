import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../contexts/RealtimeContext';
import { useAuthContext } from '../contexts/AuthContext';
import { playYip, playGrowl, playVictory, playDefeat } from '../utils/sounds';

// A wrong tap locks the grid for a "think it through" pause.
const GRID_LOCK_MS = 4000;
// Fallback: if the next problem hasn't arrived, clear the blank so a dropped
// message can't soft-lock the grid (the server stays authoritative on scores).
const BLANK_FALLBACK_MS = 2500;

// Live PvP battle engine. Returns the same shape as useBattle so the battle view
// can stay agnostic: the opponent's score rides on `aiScore`. Problems and scores
// are server-authoritative — the AI timer of single-player is gone, replaced by
// socket-driven opponent score updates.
export function useBattlePvP(matchId) {
  const rt = useRealtime();
  const { user } = useAuthContext();
  const myId = user?.id;

  const [problem, setProblem] = useState(null);
  const [grid, setGrid] = useState([]);
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(5);
  const [target, setTarget] = useState(10);
  const [opponent, setOpponent] = useState(null);
  const [nodeId, setNodeId] = useState(null);

  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'playing' | 'won' | 'lost' | 'ended'
  const [endReason, setEndReason] = useState(null);
  const [opponentLeft, setOpponentLeft] = useState(false);

  const [wrongCellIndex, setWrongCellIndex] = useState(null);
  const [gridLocked, setGridLocked] = useState(false);
  const [blanking, setBlanking] = useState(false);
  const [matchDurationMs, setMatchDurationMs] = useState(null);
  // Brief flag when the opponent just solved one, to flash their score.
  const [opponentScored, setOpponentScored] = useState(false);

  const problemIndexRef = useRef(0);
  const lockTimerRef = useRef(null);
  const blankTimerRef = useRef(null);
  const startedAtRef = useRef(Date.now());
  const statusRef = useRef(status);
  statusRef.current = status;
  const matchIdRef = useRef(matchId);
  matchIdRef.current = matchId;
  // Opponent id in a ref so the subscribe closure (created once) reads it live.
  const opponentIdRef = useRef(null);
  opponentIdRef.current = opponent?.id ?? null;

  const applyMatchState = useCallback((m) => {
    setTarget(m.target ?? 10);
    setCols(m.cols ?? 5);
    setRows(m.rows ?? 5);
    setOpponent(m.opponent ?? null);
    if (m.nodeId != null) setNodeId(m.nodeId);
    setProblem(m.problem ?? null);
    setGrid(m.grid ?? []);
    problemIndexRef.current = m.problemIndex ?? 0;
    if (m.scores && myId != null) {
      const oppId = m.opponent?.id;
      setPlayerScore(m.scores[myId] ?? 0);
      if (oppId != null) setAiScore(m.scores[oppId] ?? 0);
    }
    setBlanking(false);
    setGridLocked(false);
    setStatus('playing');
  }, [myId]);

  // Initialise from the matchStart payload the context captured, or ask the
  // server to resume (e.g. after a page refresh).
  useEffect(() => {
    if (!rt) return;
    const cur = rt.currentMatch;
    if (cur && cur.matchId === matchId) {
      applyMatchState(cur);
    } else {
      rt.send({ type: 'resumeMatch', matchId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, matchId]);

  // Subscribe to socket messages for this match.
  useEffect(() => {
    if (!rt) return undefined;
    const off = rt.subscribe((msg) => {
      if (msg.matchId && msg.matchId !== matchIdRef.current) return;
      switch (msg.type) {
        case 'matchResume':
          applyMatchState(msg);
          break;
        case 'scoreUpdate': {
          const oppId = opponentIdRef.current;
          if (myId != null) setPlayerScore(msg.scores[myId] ?? 0);
          if (oppId != null) setAiScore(msg.scores[oppId] ?? 0);
          if (msg.lastSolverId != null && msg.lastSolverId !== myId) {
            playGrowl();
            setOpponentScored(true);
            setTimeout(() => setOpponentScored(false), 700);
          }
          break;
        }
        case 'problem':
          // Next problem for me — swap it in, clearing any blank/lock.
          problemIndexRef.current = msg.problemIndex;
          setProblem(msg.problem);
          setGrid(msg.grid);
          setBlanking(false);
          if (blankTimerRef.current) { clearTimeout(blankTimerRef.current); blankTimerRef.current = null; }
          if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
          setGridLocked(false);
          break;
        case 'matchOver':
          setMatchDurationMs(Date.now() - startedAtRef.current);
          setEndReason(msg.reason);
          setOpponentLeft(false);
          if (msg.winnerId === myId) { setStatus('won'); playVictory(); }
          else { setStatus('lost'); playDefeat(); }
          break;
        case 'opponentDisconnected':
          setOpponentLeft(true);
          break;
        case 'opponentReconnected':
          setOpponentLeft(false);
          break;
        case 'matchUnavailable':
          setStatus('ended');
          break;
        default:
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, myId]);

  // Forfeit if the player leaves mid-match; clean up timers.
  useEffect(() => () => {
    if (statusRef.current === 'playing' && rt) {
      rt.send({ type: 'leaveMatch', matchId: matchIdRef.current });
    }
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (blankTimerRef.current) clearTimeout(blankTimerRef.current);
  }, [rt]);

  const handleCellTap = useCallback((cellIndex) => {
    if (status !== 'playing' || blanking || gridLocked || !problem) return;
    const value = grid[cellIndex];
    if (value === problem.answer) {
      playYip();
      // Optimistic: bump my score + blank; the server confirms via scoreUpdate
      // and sends the next problem.
      setPlayerScore((s) => s + 1);
      setBlanking(true);
      rt?.send({ type: 'problemSolved', matchId, problemIndex: problemIndexRef.current, cellIndex });
      if (blankTimerRef.current) clearTimeout(blankTimerRef.current);
      blankTimerRef.current = setTimeout(() => { blankTimerRef.current = null; setBlanking(false); }, BLANK_FALLBACK_MS);
    } else {
      setWrongCellIndex(cellIndex);
      setTimeout(() => setWrongCellIndex(null), 350);
      setGridLocked(true);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        lockTimerRef.current = null;
        setGridLocked(false);
      }, GRID_LOCK_MS);
    }
  }, [status, blanking, gridLocked, problem, grid, rt, matchId]);

  return {
    problem,
    grid,
    layoutCols: cols,
    layoutRows: rows,
    playerScore,
    aiScore,
    status,
    target,
    opponent,
    nodeId,
    endReason,
    opponentLeft,
    opponentScored,
    wrongCellIndex,
    gridLocked,
    blanking,
    matchDurationMs,
    handleCellTap,
  };
}
