const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CODE_TTL_MS = 15 * 60 * 1000;

function generateCode() {
  // 6 random digits via rejection sampling so the distribution stays uniform.
  // crypto.randomInt is inclusive-exclusive.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// POST /api/me/parent-code — mint a fresh 6-digit code for this kid, valid
// 15 minutes. Overwrites any previous code (one active code per child).
router.post('/parent-code', (req, res) => {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only kids can generate parent codes' });
  }
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO parent_claim_codes (child_id, code, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(child_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(req.user.id, code, expiresAt);
  res.json({ code, expires_at: expiresAt });
});

// GET /api/me/parent-code — current code if still valid, else 404.
router.get('/parent-code', (req, res) => {
  const row = db.prepare(
    'SELECT code, expires_at FROM parent_claim_codes WHERE child_id = ?'
  ).get(req.user.id);
  if (!row) return res.status(404).json({ error: 'No active code' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(404).json({ error: 'Code expired' });
  }
  res.json(row);
});

module.exports = router;
