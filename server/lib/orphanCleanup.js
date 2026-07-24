// Grace-period sweep for orphaned children. When a parent deletes their account
// and leaves a child with no remaining guardian, that child's users.orphanedAt
// is stamped (see server/routes/auth.js DELETE /account). This job hard-deletes
// any child still orphaned past the grace window; a kid re-adopted before then
// has orphanedAt cleared (parent link) and is never touched.
//
// Child-owned rows (node_progress, matches, user_dragons, tribe/classroom
// membership, auth_tokens, etc.) cascade on the users.id delete via their FKs.

const { and, eq, lt, sql } = require('drizzle-orm');
const { db, schema } = require('../db');

const GRACE_DAYS = 30;

// Delete children whose orphanedAt is older than the grace window. `now` is
// injectable for tests. Returns { deleted: <count> }.
async function runOrphanCleanup(now = new Date()) {
  const cutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(schema.users)
    .where(and(
      eq(schema.users.accountType, 'child'),
      sql`${schema.users.orphanedAt} IS NOT NULL`,
      lt(schema.users.orphanedAt, cutoff),
    ))
    .returning({ id: schema.users.id });
  return { deleted: deleted.length };
}

module.exports = { runOrphanCleanup, GRACE_DAYS };
