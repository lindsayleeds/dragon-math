// Which child's records may this caller touch? One answer for every route that
// takes a `child_id` from either side of the family — custom spelling lists,
// memory passages, and the iOS sync upload:
//
//   child  → only their own (a child_id naming anyone else is refused; none at
//            all means "me")
//   adult  → only a child linked to them through parent_child_links
//
// Returns the child id, or null if not permitted. `user` is `req.user`, which a
// session JWT and a parent API key publish in the same shape (see the auth
// boundaries in CLAUDE.md), so this never needs to know how the caller signed in.
const { and, eq } = require('drizzle-orm');
const { db, schema } = require('../db');

async function resolveChildAccess(user, requestedChildId) {
  if (user.account_type === 'child') {
    return requestedChildId && requestedChildId !== user.id ? null : user.id;
  }
  if (!Number.isInteger(requestedChildId) || requestedChildId <= 0) return null;
  const [link] = await db
    .select({ parentId: schema.parentChildLinks.parentId })
    .from(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, user.id),
      eq(schema.parentChildLinks.childId, requestedChildId),
    ))
    .limit(1);
  return link ? requestedChildId : null;
}

module.exports = { resolveChildAccess };
