// Guest mode: ephemeral play with no account. While guest mode is active, the
// `api` client routes auth-required endpoints here instead of hitting the
// server, so a guest can play without a token and nothing is persisted.
//
// Anything NOT matched here falls through to the real server — that covers the
// token-less public endpoints (e.g. GET /api/node-config and static map data).
// `null` is the sentinel for "no stub, pass through to the network".

import { MAP_NODES } from './mapData';

const PASS_THROUGH = Symbol('passThrough');

// The last map node — seeding a sandbox's current_node_id here unlocks the whole
// map (every lower node reads as COMPLETED, the last as AVAILABLE), so a grown-up
// in "test the games" mode can reach every battle and mini-game.
export const TEST_UNLOCK_NODE_ID = Math.max(...MAP_NODES.map(n => n.id));

// "Test the games" is guest mode launched from a teacher/parent account: same
// ephemeral, nothing-persisted behaviour, but the whole adventure is unlocked so
// they can try any game. Toggled alongside guest mode in AuthContext.
let testMode = false;

export function setGuestTestMode(on) {
  testMode = !!on;
}

// Guests start a fresh adventure with the same starter companion new kids get;
// grown-ups testing the games start with everything unlocked instead.
function guestProgress() {
  if (testMode) {
    return { current_node_id: TEST_UNLOCK_NODE_ID, username: 'Test Player', progress: [] };
  }
  return { current_node_id: 1, username: 'Guest', progress: [] };
}

function guestCompanions() {
  return { owned: [{ companion_id: 'pip' }], active_companion_id: 'pip' };
}

// Mirrors the shape of GET /api/mastery: a full 1-12 grid per operation with no
// attempts yet. Guests/testers persist nothing, so every cell reads as unplayed.
// Returning the seeded grid (not a bare {}) keeps the Learning Lair pages from
// crashing when they destructure `{ operations }` and index into it.
function guestMastery() {
  const operations = {};
  for (const op of ['add', 'sub', 'mul', 'div']) {
    operations[op] = {};
    for (let n = 1; n <= 12; n++) {
      operations[op][n] = { total: 0, childWins: 0, accuracy: null };
    }
  }
  return { operations };
}

// Returns the stubbed response for a guest request, or PASS_THROUGH to let the
// real network request proceed.
export function guestRespond(path, method) {
  const m = method.toUpperCase();
  // Strip any query string for matching.
  const clean = path.split('?')[0];

  if (m === 'GET') {
    if (clean === '/api/progress') return guestProgress();
    if (clean === '/api/companions') return guestCompanions();
    if (clean === '/api/mastery') return guestMastery();
    if (clean === '/api/dragons') return { owned: [], dragons: [] };
    if (clean === '/api/classroom/me') return { classrooms: [] };
    if (clean.startsWith('/api/leaderboard/')) return [];
    return PASS_THROUGH; // public reads (node-config, map structure, …)
  }

  // Writes: silently succeed without persisting.
  if (m === 'POST') {
    if (clean === '/api/matches') return { id: 'guest-match' };
    if (clean === '/api/companions/capture') return guestCompanions();
    return {};
  }
  if (m === 'PUT' || m === 'PATCH' || m === 'DELETE') return {};

  return PASS_THROUGH;
}

export { PASS_THROUGH };
