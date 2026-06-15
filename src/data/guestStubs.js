// Guest mode: ephemeral play with no account. While guest mode is active, the
// `api` client routes auth-required endpoints here instead of hitting the
// server, so a guest can play without a token and nothing is persisted.
//
// Anything NOT matched here falls through to the real server — that covers the
// token-less public endpoints (e.g. GET /api/node-config and static map data).
// `null` is the sentinel for "no stub, pass through to the network".

const PASS_THROUGH = Symbol('passThrough');

// Guests start a fresh adventure with the same starter companion new kids get.
function guestProgress() {
  return { current_node_id: 1, username: 'Guest', progress: [] };
}

function guestCompanions() {
  return { owned: [{ companion_id: 'pip' }], active_companion_id: 'pip' };
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
    if (clean === '/api/mastery') return {};
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
