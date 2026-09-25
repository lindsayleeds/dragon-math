// Deleting a parent account and their children's data, for the iOS app's
// in-app account deletion (POST /api/account/delete, App Store Review Guideline
// 5.1.1(v); docs/COPPA.md "Account deletion").
//
// What goes, in one transaction:
//
// - The parent's own row, and everything that cascades from it: their
//   parent_child_links, api_keys, auth_tokens, weekly_report_log, classrooms and
//   tribes they own, school admin/teacher memberships.
// - Every child linked to them who has NO other parent: deleted outright, now —
//   not stamped orphanedAt for the web route's 30-day grace sweep — so a kid's
//   login link stops working with the deletion. That holds even when a teacher
//   also has the child in a classroom: the parent asked for their child's data to
//   be deleted, which is theirs to ask for under COPPA.
// - A child who still has another parent (a co-parent) is only UNLINKED from the
//   deleting parent. Their data is the co-parent's family's too, so it stays.
//
// What is kept, with the user id set to NULL (anonymized, by the FKs' ON DELETE
// SET NULL): billing_events (the churn funnel), app_store_subscriptions (Apple is
// the source of truth; the parent cancels through their Apple ID), comp invite
// redemptions, and the created_by / submitted_by of anything the parent wrote for
// a co-parented child (memory passages, spelling lists, synced events).
//
// Most child-data tables cascade on users.id, but node_progress,
// problem_attempts, wrong_taps, user_companions, play_minutes and matches do not
// (see DELETE /api/admin/children/:userId), so those are cleared first, and
// another kid's match naming a deleted child as its PvP opponent is un-named.
const { and, asc, eq, inArray, ne } = require('drizzle-orm');
const { schema } = require('../db');

// The tables whose users FK has no ON DELETE, keyed by the column.
const NON_CASCADING = [
  schema.nodeProgress,
  schema.problemAttempts,
  schema.wrongTaps,
  schema.userCompanions,
  schema.playMinutes,
  schema.matches,
];

async function deleteUserRows(tx, userIds) {
  if (userIds.length === 0) return;
  for (const table of NON_CASCADING) {
    await tx.delete(table).where(inArray(table.userId, userIds));
  }
  await tx.update(schema.matches)
    .set({ opponentUserId: null })
    .where(inArray(schema.matches.opponentUserId, userIds));
  await tx.delete(schema.users).where(inArray(schema.users.id, userIds));
}

// Deletes `parentId` and their sole-guardian children inside `tx` (a drizzle
// transaction). → { deletedChildIds, unlinkedChildIds }, both ascending, or null
// when there is no such parent.
//
// Two co-parents deleting at the same moment must not each see the other as
// "still linked" and both leave the child behind with nobody. So every linked
// child's row is locked (in id order, so two deletions can't deadlock) before the
// other links are counted: the second deletion waits, then sees the first one's
// link gone and deletes the child.
async function deleteParentAccount(tx, parentId) {
  const [parent] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, parentId), eq(schema.users.accountType, 'parent')))
    .for('update');
  if (!parent) return null;

  const links = await tx
    .select({ childId: schema.parentChildLinks.childId })
    .from(schema.parentChildLinks)
    .where(eq(schema.parentChildLinks.parentId, parentId))
    .orderBy(asc(schema.parentChildLinks.childId));
  const childIds = links.map(l => l.childId);

  const deletedChildIds = [];
  const unlinkedChildIds = [];
  if (childIds.length > 0) {
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, childIds))
      .orderBy(asc(schema.users.id))
      .for('update');
    const others = await tx
      .selectDistinct({ childId: schema.parentChildLinks.childId })
      .from(schema.parentChildLinks)
      .where(and(
        inArray(schema.parentChildLinks.childId, childIds),
        ne(schema.parentChildLinks.parentId, parentId),
      ));
    const coParented = new Set(others.map(o => o.childId));
    for (const id of childIds) (coParented.has(id) ? unlinkedChildIds : deletedChildIds).push(id);
  }

  await deleteUserRows(tx, deletedChildIds);
  await deleteUserRows(tx, [parentId]);
  return { deletedChildIds, unlinkedChildIds };
}

module.exports = { deleteParentAccount };
