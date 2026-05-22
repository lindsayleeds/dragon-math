const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dragon-math-dev-secret-change-in-prod';

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireParent(req, res, next) {
  if (req.user?.account_type !== 'parent') {
    return res.status(403).json({ error: 'Parent account required' });
  }
  next();
}

// Verifies the signed-in parent is linked to the child in req.params.childId.
function requireOwnsChild(req, res, next) {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid child id' });
  }
  const link = db
    .prepare('SELECT 1 FROM parent_child_links WHERE parent_id = ? AND child_id = ?')
    .get(req.user.id, childId);
  if (!link) return res.status(403).json({ error: 'Not your child' });
  req.childId = childId;
  next();
}

module.exports = { requireAuth, requireParent, requireOwnsChild, JWT_SECRET };
