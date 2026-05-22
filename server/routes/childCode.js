const express = require('express');
const crypto = require('crypto');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
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
router.post('/parent-code', async (req, res) => {
  if (req.user.account_type === 'parent') {
    return res.status(403).json({ error: 'Only kids can generate parent codes' });
  }
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db
    .insert(schema.parentClaimCodes)
    .values({ childId: req.user.id, code, expiresAt })
    .onConflictDoUpdate({
      target: schema.parentClaimCodes.childId,
      set: { code: sql`excluded.code`, expiresAt: sql`excluded.expires_at` },
    });
  res.json({ code, expires_at: expiresAt.toISOString() });
});

// GET /api/me/parent-code — current code if still valid, else 404.
router.get('/parent-code', async (req, res) => {
  const rows = await db
    .select({ code: schema.parentClaimCodes.code, expires_at: schema.parentClaimCodes.expiresAt })
    .from(schema.parentClaimCodes)
    .where(eq(schema.parentClaimCodes.childId, req.user.id))
    .limit(1);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'No active code' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(404).json({ error: 'Code expired' });
  }
  res.json({ code: row.code, expires_at: row.expires_at.toISOString() });
});

module.exports = router;
