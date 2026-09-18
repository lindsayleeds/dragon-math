const { eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('./auth');
const { rateLimit } = require('../lib/rateLimit');

// Require both an admin session and a current role. Old parent sessions cannot
// gain privileges after promotion; demotion revokes every admin session at once.
function requireAdmin(req, res, next) {
  return requireAuth(req, res, async () => {
    try {
      if (req.user.account_type !== 'admin') {
        return res.status(403).json({ error: 'Admin account required' });
      }
      const limit = await rateLimit({ key: `admin-auth:${req.user.id}`, limit: 300, windowMs: 15 * 60 * 1000 });
      if (!limit.allowed) return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
      const [user] = await db.select({ id: schema.users.id, accountType: schema.users.accountType })
        .from(schema.users).where(eq(schema.users.id, req.user.id)).limit(1);
      if (user?.accountType !== 'admin') {
        return res.status(403).json({ error: 'Admin access has been revoked' });
      }
      res.on('finish', () => {
        console.info(JSON.stringify({ event: 'admin_request', actorId: user.id,
          method: req.method, path: req.baseUrl + req.path, status: res.statusCode }));
      });
      next();
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { requireAdmin };
