const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;

// Curated set of avatars the player may choose from. Centralized here so the
// server can reject anything outside the list — prevents arbitrary strings
// (or hostile payloads) from being stored as a user's avatar.
const ALLOWED_AVATARS = [
  '⚔️', '🗡️', '🏹', '🛡️',
  '🧙‍♀️', '🧝‍♀️', '🧚', '👸',
  '🦄', '🐉', '🐲', '🐱',
  '🐰', '🦊', '🐺', '🦁',
  '🐯', '🐼', '🐨', '🦉',
];

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    current_node_id: user.current_node_id,
    avatar: user.avatar || '⚔️',
  };
}

// POST /api/auth/signin — finds the user by username, creating one if needed.
router.post('/signin', (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw))
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(raw);
  if (!user) {
    const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(raw);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }

  res.json({ token: signToken(user), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safeUser(user) });
});

// GET /api/auth/avatars — list of avatars the client may offer to the user.
router.get('/avatars', requireAuth, (req, res) => {
  res.json({ avatars: ALLOWED_AVATARS });
});

// PUT /api/auth/profile — update the signed-in user's profile (currently
// just avatar, but shaped to accept additional fields later).
router.put('/profile', requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  if (typeof avatar !== 'string' || !ALLOWED_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: safeUser(user) });
});

module.exports = router;
