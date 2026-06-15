const crypto = require('crypto');

// In-memory realtime state. The API runs as a single PM2 process, so a plain
// Map is the authoritative store — no Redis/pubsub needed. A process restart
// (pm2 reload) wipes this: active matches end and clients fall back to the map.

// userId -> { ws, username, avatar, status: 'idle' | 'inMatch' }
const onlineUsers = new Map();

// challengeId -> { fromId, toId, nodeId, timer }
const pendingChallenges = new Map();

// matchId -> MatchState (see realtime/index.js startMatch)
const matches = new Map();

// userId -> matchId (reverse index for fast disconnect/resume lookups). Kept
// across a disconnect so the player can resume; cleared when the match ends.
const userMatch = new Map();

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

module.exports = { onlineUsers, pendingChallenges, matches, userMatch, newId };
