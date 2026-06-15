import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from './AuthContext';

const RealtimeContext = createContext(null);

// App-level websocket: presence + challenge lobby + live PvP match routing.
// Mounted inside AuthProvider (needs the token) and BrowserRouter (needs
// navigate) so presence and incoming challenges work on any page.
export function RealtimeProvider({ children }) {
  const { session, user } = useAuthContext();
  const navigate = useNavigate();
  // Held in a ref so the socket effect below doesn't list `navigate` as a
  // dependency. React Router recreates `navigate` on every location change, so
  // depending on it would tear down and re-open the websocket on each route
  // change (e.g. when we navigate into /battle/pvp on matchStart) — and the old
  // socket's late `onclose` would then null out `wsRef` after the new socket had
  // already claimed it, silently dropping every send on the battle page.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const wsRef = useRef(null);
  const listenersRef = useRef(new Set());
  const reconnectRef = useRef(null);
  const backoffRef = useRef(1000);

  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(() => new Set());
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  const [outgoingChallenge, setOutgoingChallenge] = useState(null);
  const [currentMatch, setCurrentMatch] = useState(null);

  const isKid =
    !!session &&
    user?.account_type !== 'parent' &&
    user?.account_type !== 'guest' &&
    !user?.needs_handle;

  // Fan a message out to all subscribers (e.g. the active battle hook).
  const dispatch = useCallback((msg) => {
    listenersRef.current.forEach((l) => { try { l(msg); } catch { /* noop */ } });
  }, []);

  const subscribe = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!isKid) return undefined;
    let stopped = false;

    function handleMessage(msg) {
      switch (msg.type) {
        case 'presence':
          setOnline(new Set(msg.online));
          break;
        case 'challengeIncoming':
          setIncomingChallenge(msg);
          break;
        case 'challengeSent':
          setOutgoingChallenge({ challengeId: msg.challengeId, toUserId: msg.toUserId, status: 'waiting' });
          break;
        case 'challengeDeclined':
          setOutgoingChallenge((o) => (o ? { ...o, status: 'declined' } : o));
          break;
        case 'challengeExpired':
          setOutgoingChallenge((o) => (o && o.challengeId === msg.challengeId ? { ...o, status: 'expired' } : o));
          setIncomingChallenge((c) => (c && c.challengeId === msg.challengeId ? null : c));
          break;
        case 'challengeCancelled':
          setIncomingChallenge((c) => (c && c.challengeId === msg.challengeId ? null : c));
          break;
        case 'challengeUnavailable':
          setOutgoingChallenge({ status: 'unavailable', reason: msg.reason });
          break;
        case 'matchStart':
          setIncomingChallenge(null);
          setOutgoingChallenge(null);
          setCurrentMatch(msg);
          navigateRef.current(`/battle/pvp/${msg.matchId}`);
          break;
        case 'matchResume':
          setCurrentMatch(msg);
          break;
        case 'matchOver':
          setCurrentMatch(null);
          break;
        default:
          break;
      }
    }

    function connect() {
      const token = localStorage.getItem('dm_token');
      if (!token) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/rt?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => { setConnected(true); backoffRef.current = 1000; };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        handleMessage(msg);
        dispatch(msg);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
      ws.onclose = () => {
        setConnected(false);
        // Only clear the ref if this socket is still the active one — a late
        // close from a superseded socket must not clobber a newer connection.
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        reconnectRef.current = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
      };
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } wsRef.current = null; }
      setConnected(false);
      setOnline(new Set());
      setIncomingChallenge(null);
      setOutgoingChallenge(null);
    };
  }, [isKid, dispatch]);

  const sendChallenge = useCallback((toUserId, nodeId) => {
    setOutgoingChallenge({ status: 'waiting', toUserId });
    send({ type: 'challenge', toUserId, nodeId });
  }, [send]);

  const respondChallenge = useCallback((challengeId, accept) => {
    send({ type: 'challengeRespond', challengeId, accept });
    if (!accept) setIncomingChallenge(null);
  }, [send]);

  const cancelChallenge = useCallback((challengeId) => {
    if (challengeId) send({ type: 'challengeCancel', challengeId });
    setOutgoingChallenge(null);
  }, [send]);

  const clearOutgoing = useCallback(() => setOutgoingChallenge(null), []);
  const isOnline = useCallback((id) => online.has(id), [online]);

  const value = {
    connected,
    online,
    isOnline,
    incomingChallenge,
    outgoingChallenge,
    currentMatch,
    sendChallenge,
    respondChallenge,
    cancelChallenge,
    clearOutgoing,
    subscribe,
    send,
  };

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
