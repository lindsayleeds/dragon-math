// Hardcoded admin password — gates the /admin tools. Override via env in real
// deployments; defaults to "dragon" for local development.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dragon';

function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

module.exports = { requireAdmin, ADMIN_PASSWORD };
