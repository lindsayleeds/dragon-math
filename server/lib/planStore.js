// The database side of plan status (ADR 0008): the reads the plan resolver needs
// and the App Store notification write. Decisions live in pure modules —
// ./planStatus.js (which grant wins) and ./appStoreNotifications.js (what a
// notification does to a subscription) — so this file only moves rows.
//
// Kept as one module with a small surface on purpose: route tests swap it for an
// in-memory copy (server/routes/appStore.test.js), and ./planStore.pg.test.js
// runs this real one against Postgres.
const crypto = require('crypto');
const { and, eq, inArray, isNull, ne, sql } = require('drizzle-orm');
const { db, schema } = require('../db');

const subs = schema.appStoreSubscriptions;

// The plan-bearing columns of each adult's users row.
async function accountPlanRows(userIds) {
  if (!userIds.length) return [];
  return db
    .select({
      id: schema.users.id,
      plan: schema.users.plan,
      comped: schema.users.comped,
      planStatus: schema.users.planStatus,
      stripeSubscriptionId: schema.users.stripeSubscriptionId,
      planRenewsAt: schema.users.planRenewsAt,
      planCancelAtPeriodEnd: schema.users.planCancelAtPeriodEnd,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
}

// Every App Store subscription row linked to these adults, entitled or not —
// appStoreGrant() decides which grant.
async function appStoreRowsForUsers(userIds) {
  if (!userIds.length) return [];
  return db.select().from(subs).where(inArray(subs.userId, userIds));
}

// A child's guardians: linked parents and the teachers of their classrooms.
async function guardiansOfChild(childId) {
  const parents = await db
    .select({ id: schema.parentChildLinks.parentId })
    .from(schema.parentChildLinks)
    .where(eq(schema.parentChildLinks.childId, childId));
  const teachers = await db
    .select({ id: schema.classrooms.teacherId })
    .from(schema.classroomMembers)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.classroomMembers.classroomId))
    .where(eq(schema.classroomMembers.childId, childId));
  return { parentIds: parents.map(r => r.id), teacherIds: teachers.map(r => r.id) };
}

// This adult's appAccountToken, minted on first use. The conditional UPDATE
// makes two concurrent first calls agree: only one write lands, and both read
// back the winner.
async function appAccountTokenFor(userId) {
  await db
    .update(schema.users)
    .set({ appAccountToken: crypto.randomUUID() })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.appAccountToken)));
  const [row] = await db
    .select({ token: schema.users.appAccountToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.token ?? null;
}

// Apply one verified notification, exactly once. `decide(existing, notice,
// { linkedUserId })` is subscriptionUpdate() with the product map bound. Returns
// { outcome: 'duplicate' | 'ignored' | 'stale' | 'applied' }.
//
// One transaction: the notificationUUID insert is the idempotency guard (a
// concurrent retry blocks on the unique index, then finds the row), and it only
// commits together with the subscription write — so a failure rolls both back
// and Apple's retry is processed properly rather than skipped as a duplicate.
async function processNotification(notice, decide) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.appStoreNotifications)
      .values({
        notificationUuid: notice.notificationUUID,
        notificationType: notice.notificationType,
        subtype: notice.subtype,
        originalTransactionId: notice.transaction?.originalTransactionId ?? null,
        environment: notice.environment,
        signedAt: notice.signedAt,
        outcome: 'pending',
      })
      .onConflictDoNothing({ target: schema.appStoreNotifications.notificationUuid })
      .returning({ id: schema.appStoreNotifications.id });
    if (!inserted.length) return { outcome: 'duplicate' };

    const t = notice.transaction;
    let existing = null;
    let linkedUserId = null;
    if (t?.originalTransactionId) {
      [existing = null] = await tx
        .select()
        .from(subs)
        .where(and(
          eq(subs.originalTransactionId, t.originalTransactionId),
          eq(subs.inAppOwnershipType, t.inAppOwnershipType),
        ))
        .for('update')
        .limit(1);
      if (!existing?.userId && t.appAccountToken) {
        const [owner] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(
            eq(schema.users.appAccountToken, t.appAccountToken),
            ne(schema.users.accountType, 'child'),
          ))
          .limit(1);
        linkedUserId = owner?.id ?? null;
      }
    }

    const result = decide(existing, notice, { linkedUserId });
    if (result.outcome === 'applied') {
      const values = { ...result.row, updatedAt: new Date() };
      await tx
        .insert(subs)
        .values(values)
        .onConflictDoUpdate({
          target: [subs.originalTransactionId, subs.inAppOwnershipType],
          set: values,
          // A first-sight race (two notifications for a subscription neither has
          // seen yet) is settled here: the newer signedDate wins either order.
          setWhere: sql`${subs.lastSignedAt} <= excluded.last_signed_at`,
        });
    }
    await tx
      .update(schema.appStoreNotifications)
      .set({ outcome: result.outcome })
      .where(eq(schema.appStoreNotifications.id, inserted[0].id));
    return { outcome: result.outcome };
  });
}

module.exports = {
  accountPlanRows,
  appStoreRowsForUsers,
  guardiansOfChild,
  appAccountTokenFor,
  processNotification,
};
