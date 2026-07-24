const jwt = require('jsonwebtoken');
const { and, eq } = require('drizzle-orm');
const { db, schema } = require('../db');

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

// Teachers are adult accounts (account_type 'parent') with adult_role 'teacher'.
// Use after requireAuth + requireParent.
function requireTeacher(req, res, next) {
  if (req.user?.adult_role !== 'teacher') {
    return res.status(403).json({ error: 'Teacher account required' });
  }
  next();
}

// Verifies the signed-in teacher owns the classroom in req.params.classroomId.
async function requireOwnsClassroom(req, res, next) {
  const classroomId = Number(req.params.classroomId);
  if (!Number.isInteger(classroomId) || classroomId <= 0) {
    return res.status(400).json({ error: 'Invalid classroom id' });
  }
  const owned = await db
    .select({ id: schema.classrooms.id })
    .from(schema.classrooms)
    .where(and(
      eq(schema.classrooms.id, classroomId),
      eq(schema.classrooms.teacherId, req.user.id),
    ))
    .limit(1);
  if (owned.length === 0) return res.status(403).json({ error: 'Not your classroom' });
  req.classroomId = classroomId;
  next();
}

// Verifies the signed-in adult is an admin of the school in req.params.schoolId.
// School-admin status lives in the school_admins table (never in the JWT), same
// as `plan` — so it's always read fresh from the DB. Use after requireAuth.
async function requireSchoolAdmin(req, res, next) {
  const schoolId = Number(req.params.schoolId);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ error: 'Invalid school id' });
  }
  const rows = await db
    .select({ userId: schema.schoolAdmins.userId })
    .from(schema.schoolAdmins)
    .where(and(
      eq(schema.schoolAdmins.schoolId, schoolId),
      eq(schema.schoolAdmins.userId, req.user.id),
    ))
    .limit(1);
  if (rows.length === 0) return res.status(403).json({ error: 'Not a school admin' });
  req.schoolId = schoolId;
  next();
}

// Verifies the signed-in parent is linked to the child in req.params.childId.
async function requireOwnsChild(req, res, next) {
  const childId = Number(req.params.childId);
  if (!Number.isInteger(childId) || childId <= 0) {
    return res.status(400).json({ error: 'Invalid child id' });
  }
  const link = await db
    .select({ parentId: schema.parentChildLinks.parentId })
    .from(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, req.user.id),
      eq(schema.parentChildLinks.childId, childId),
    ))
    .limit(1);
  if (link.length === 0) return res.status(403).json({ error: 'Not your child' });
  req.childId = childId;
  next();
}

module.exports = {
  requireAuth,
  requireParent,
  requireTeacher,
  requireOwnsChild,
  requireOwnsClassroom,
  requireSchoolAdmin,
  JWT_SECRET,
};
