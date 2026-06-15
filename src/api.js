import { guestRespond, PASS_THROUGH } from './data/guestStubs';

const BASE_URL = '';

// Guest mode lives only in memory — never persisted — so a refresh ends the
// guest session. While on, auth-required endpoints are answered locally.
let guestMode = false;

export function setGuestMode(on) {
  guestMode = !!on;
}

function getToken() {
  return localStorage.getItem('dm_token');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('dm_token', token);
  } else {
    localStorage.removeItem('dm_token');
  }
}

async function request(path, options = {}) {
  if (guestMode) {
    const stub = guestRespond(path, options.method || 'GET');
    if (stub !== PASS_THROUGH) return stub;
  }

  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get:    (path)       => request(path, { method: 'GET' }),
  post:   (path, body) => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body) => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body) => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)       => request(path, { method: 'DELETE' }),
};
