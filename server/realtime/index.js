const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const url = require('url');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { makeProblem, PVP_COLS, PVP_ROWS } = require('../lib/battleCore');
const { onlineUsers, pendingChallenges, matches, userMatch, newId } = require('./state');

const TARGET = 10;                          // problems to win — mirrors PROBLEMS_TO_WIN
const CHALLENGE_TTL_MS = 30 * 1000;         // unanswered challenges expire
const DISCONNECT_GRACE_MS = 30 * 1000;      // grace before a dropped player forfeits
const HEARTBEAT_MS = 25 * 1000;             // ping interval (< nginx 300s read timeout)

let wss;

// ───────────────────────── send helpers ─────────────────────────

function send(ws, type, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function sendTo(userId, type, payload) {
  const entry = onlineUsers.get(userId);
  if (entry) send(entry.ws, type, payload);
}

// Everyone gets the full online list; clients filter to their tribemates.
function broadcastPresence() {
  const online = [...onlineUsers.keys()];
  for (const { ws } of onlineUsers.values()) send(ws, 'presence', { online });
}

// ───────────────────────── node config ─────────────────────────

function safeParseOps(raw) {
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) && p.length ? p : ['add'];
  } catch {
    return ['add'];
  }
}

async function configForNode(nodeId) {
  const [row] = await db
    .select({
      ops: schema.nodeConfig.ops,
      range_min: schema.nodeConfig.rangeMin,
      range_max: schema.nodeConfig.rangeMax,
    })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  if (!row) return { ops: ['add'], range: [1, 10] };
  return { ops: safeParseOps(row.ops), range: [row.range_min ?? 1, row.range_max ?? 10] };
}

// ───────────────────────── match helpers ─────────────────────────

function opponentOf(match, userId) {
  return Object.keys(match.players).map(Number).find(x => x !== userId);
}

function scoresOf(match) {
  const out = {};
  for (const [uid, p] of Object.entries(match.players)) out[uid] = p.score;
  return out;
}

// Problems are generated lazily and cached, so both players walk the SAME
// sequence at their own pace.
function getProblem(match, index) {
  while (match.problems.length <= index) match.problems.push(makeProblem(match.config));
  return match.problems[index];
}

async function startMatch(aId, bId, nodeId) {
  const config = await configForNode(nodeId);
  const matchId = newId('m');
  const pvpUid = crypto.randomUUID();

  const players = {};
  for (const uid of [aId, bId]) {
    players[uid] = { score: 0, index: 0, connected: true, disconnectTimer: null, dbRowId: null };
  }
  const match = { matchId, nodeId, config, players, problems: [], status: 'active', winnerId: null, pvpUid };
  matches.set(matchId, match);
  userMatch.set(aId, matchId);
  userMatch.set(bId, matchId);

  // One DB row per player (mirrors single-player matches; reuses the outcome enum).
  for (const uid of [aId, bId]) {
    const opp = opponentOf(match, uid);
    try {
      const [row] = await db
        .insert(schema.matches)
        .values({ userId: uid, nodeId, opponentUserId: opp, matchKind: 'pvp', pvpMatchUid: pvpUid })
        .returning({ id: schema.matches.id });
      match.players[uid].dbRowId = row.id;
    } catch (err) {
      console.error('[realtime] failed to open match row', err);
    }
  }

  for (const uid of [aId, bId]) {
    const e = onlineUsers.get(uid);
    if (e) e.status = 'inMatch';
  }

  const p0 = getProblem(match, 0);
  for (const uid of [aId, bId]) {
    const oppId = opponentOf(match, uid);
    const oppEntry = onlineUsers.get(oppId);
    sendTo(uid, 'matchStart', {
      matchId,
      nodeId,
      target: TARGET,
      cols: PVP_COLS,
      rows: PVP_ROWS,
      opponent: { id: oppId, username: oppEntry?.username, avatar: oppEntry?.avatar },
      problemIndex: 0,
      problem: p0.problem,
      grid: p0.grid,
    });
  }
}

async function endMatch(match, winnerId, reason) {
  if (match.status === 'over') return;
  match.status = 'over';
  match.winnerId = winnerId;
  const scores = scoresOf(match);

  for (const uidStr of Object.keys(match.players)) {
    const uid = Number(uidStr);
    const p = match.players[uid];
    if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = null; }

    // Tell the player first, then persist (snappier; persistence is best-effort).
    sendTo(uid, 'matchOver', { matchId: match.matchId, winnerId, scores, reason });

    const oppId = opponentOf(match, uid);
    const outcome = winnerId == null ? 'incomplete' : (uid === winnerId ? 'child' : 'ai');
    if (p.dbRowId) {
      db.update(schema.matches)
        .set({ endedAt: sql`now()`, outcome, playerScore: p.score, aiScore: match.players[oppId]?.score ?? 0 })
        .where(eq(schema.matches.id, p.dbRowId))
        .catch(err => console.error('[realtime] failed to finalize match row', err));
    }

    const e = onlineUsers.get(uid);
    if (e) e.status = 'idle';
    userMatch.delete(uid);
  }

  matches.delete(match.matchId);
}

// ───────────────────────── message handlers ─────────────────────────

function handleChallenge(fromId, msg) {
  const toId = Number(msg.toUserId);
  const nodeId = Number(msg.nodeId);
  if (!Number.isInteger(toId) || toId === fromId) return;
  if (!Number.isInteger(nodeId) || nodeId < 1) return;

  const fromEntry = onlineUsers.get(fromId);
  const toEntry = onlineUsers.get(toId);
  if (!toEntry) return sendTo(fromId, 'challengeUnavailable', { toUserId: toId, reason: 'offline' });
  if (toEntry.status === 'inMatch' || fromEntry?.status === 'inMatch') {
    return sendTo(fromId, 'challengeUnavailable', { toUserId: toId, reason: 'busy' });
  }

  const challengeId = newId('c');
  const timer = setTimeout(() => {
    pendingChallenges.delete(challengeId);
    sendTo(fromId, 'challengeExpired', { challengeId });
    sendTo(toId, 'challengeExpired', { challengeId });
  }, CHALLENGE_TTL_MS);
  pendingChallenges.set(challengeId, { fromId, toId, nodeId, timer });

  sendTo(toId, 'challengeIncoming', {
    challengeId,
    fromUserId: fromId,
    fromUsername: fromEntry?.username,
    fromAvatar: fromEntry?.avatar,
    nodeId,
  });
  sendTo(fromId, 'challengeSent', { challengeId, toUserId: toId });
}

function handleChallengeRespond(userId, msg) {
  const ch = pendingChallenges.get(msg.challengeId);
  if (!ch || ch.toId !== userId) return;
  clearTimeout(ch.timer);
  pendingChallenges.delete(msg.challengeId);

  if (!msg.accept) {
    return sendTo(ch.fromId, 'challengeDeclined', { challengeId: msg.challengeId });
  }
  const from = onlineUsers.get(ch.fromId);
  const to = onlineUsers.get(ch.toId);
  if (!from || !to || from.status === 'inMatch' || to.status === 'inMatch') {
    sendTo(ch.fromId, 'challengeUnavailable', { reason: 'offline' });
    sendTo(ch.toId, 'challengeUnavailable', { reason: 'offline' });
    return;
  }
  startMatch(ch.fromId, ch.toId, ch.nodeId).catch(err => console.error('[realtime] startMatch failed', err));
}

function handleChallengeCancel(userId, msg) {
  const ch = pendingChallenges.get(msg.challengeId);
  if (!ch || ch.fromId !== userId) return;
  clearTimeout(ch.timer);
  pendingChallenges.delete(msg.challengeId);
  sendTo(ch.toId, 'challengeCancelled', { challengeId: msg.challengeId });
}

function handleProblemSolved(userId, msg) {
  const match = matches.get(msg.matchId);
  if (!match || match.status !== 'active') return;
  const player = match.players[userId];
  if (!player) return;
  if (msg.problemIndex !== player.index) return; // stale or duplicate

  const cur = getProblem(match, player.index);
  // Anti-cheat: the tapped cell must actually hold the answer.
  if (typeof msg.cellIndex === 'number' && cur.grid[msg.cellIndex] !== cur.problem.answer) return;

  player.score += 1;
  player.index += 1;

  const scores = scoresOf(match);
  for (const uid of Object.keys(match.players)) {
    sendTo(Number(uid), 'scoreUpdate', { matchId: match.matchId, scores, lastSolverId: userId });
  }

  if (player.score >= TARGET) {
    endMatch(match, userId, 'reached_target').catch(err => console.error('[realtime] endMatch failed', err));
    return;
  }

  const next = getProblem(match, player.index);
  sendTo(userId, 'problem', {
    matchId: match.matchId,
    problemIndex: player.index,
    problem: next.problem,
    grid: next.grid,
  });
}

function handleResume(userId, msg) {
  const match = matches.get(msg.matchId);
  if (!match || !match.players[userId] || match.status !== 'active') {
    return sendTo(userId, 'matchUnavailable', { matchId: msg.matchId });
  }
  const player = match.players[userId];
  player.connected = true;
  if (player.disconnectTimer) { clearTimeout(player.disconnectTimer); player.disconnectTimer = null; }

  const oppId = opponentOf(match, userId);
  const oppEntry = onlineUsers.get(oppId);
  const cur = getProblem(match, player.index);
  sendTo(userId, 'matchResume', {
    matchId: match.matchId,
    nodeId: match.nodeId,
    target: TARGET,
    cols: PVP_COLS,
    rows: PVP_ROWS,
    opponent: { id: oppId, username: oppEntry?.username, avatar: oppEntry?.avatar },
    scores: scoresOf(match),
    problemIndex: player.index,
    problem: cur.problem,
    grid: cur.grid,
  });
  sendTo(oppId, 'opponentReconnected', { matchId: match.matchId });
}

function handleLeave(userId, msg) {
  const match = matches.get(msg.matchId);
  if (!match || !match.players[userId] || match.status !== 'active') return;
  endMatch(match, opponentOf(match, userId), 'forfeit')
    .catch(err => console.error('[realtime] endMatch failed', err));
}

function handleDisconnect(userId) {
  onlineUsers.delete(userId);
  broadcastPresence();

  const matchId = userMatch.get(userId);
  if (!matchId) return;
  const match = matches.get(matchId);
  if (!match || match.status !== 'active') return;
  const player = match.players[userId];
  if (!player) return;

  player.connected = false;
  const oppId = opponentOf(match, userId);
  sendTo(oppId, 'opponentDisconnected', { matchId, graceMs: DISCONNECT_GRACE_MS });

  player.disconnectTimer = setTimeout(() => {
    const m = matches.get(matchId);
    if (!m || m.status !== 'active') return;
    if (m.players[userId]?.connected) return; // reconnected in time
    // If the opponent is also gone, neither finished → incomplete; else opponent wins.
    const winner = m.players[oppId]?.connected ? oppId : null;
    endMatch(m, winner, 'disconnect').catch(err => console.error('[realtime] endMatch failed', err));
  }, DISCONNECT_GRACE_MS);
}

// ───────────────────────── attach to HTTP server ─────────────────────────

function attach(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);
    if (pathname !== '/api/rt') { socket.destroy(); return; }

    let payload;
    try {
      payload = jwt.verify(query.token || '', JWT_SECRET);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (payload.account_type === 'parent') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = Number(payload.id);
      ws.username = payload.username;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const userId = ws.userId;

    // A reconnect replaces any stale socket for this user.
    const existing = onlineUsers.get(userId);
    if (existing && existing.ws !== ws) { try { existing.ws.terminate(); } catch { /* noop */ } }

    onlineUsers.set(userId, {
      ws,
      username: ws.username,
      avatar: '⚔️',
      status: userMatch.has(userId) ? 'inMatch' : 'idle',
    });
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Best-effort avatar load for presence/challenge display.
    db.select({ avatar: schema.users.avatar })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .then(([row]) => { const e = onlineUsers.get(userId); if (e && row?.avatar) e.avatar = row.avatar; })
      .catch(() => {});

    broadcastPresence();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.type) {
        case 'challenge': return handleChallenge(userId, msg);
        case 'challengeRespond': return handleChallengeRespond(userId, msg);
        case 'challengeCancel': return handleChallengeCancel(userId, msg);
        case 'problemSolved': return handleProblemSolved(userId, msg);
        case 'resumeMatch': return handleResume(userId, msg);
        case 'leaveMatch': return handleLeave(userId, msg);
        default: return;
      }
    });

    ws.on('close', () => {
      // Ignore the close of a socket already replaced by a reconnect.
      const e = onlineUsers.get(userId);
      if (e && e.ws !== ws) return;
      handleDisconnect(userId);
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* noop */ }
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(interval));

  console.log('🔌 Realtime PvP websocket attached at /api/rt');
}

module.exports = { attach };
