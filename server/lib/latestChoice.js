// "The latest choice wins" for sync kinds that set one value on the child —
// the companion they take into battle (companion_chosen), their font theme
// (font_chosen). A device's queue can upload in any order, so an event only
// writes its value when no other event of the same kind for the user is later
// (by occurred_at, then by id, compared case-insensitively). Called inside the
// event's own transaction, after its sync_events row is inserted, so two
// racing uploads serialize on those rows and agree on the end state.
const { and, eq, gt, or, sql } = require('drizzle-orm');
const schema = require('../db/schema');

async function isSuperseded(exec, { userId, kind, eventId, occurredAt }) {
  const e = schema.syncEvents;
  const later = await exec
    .select({ id: e.id })
    .from(e)
    .where(and(
      eq(e.userId, userId),
      eq(e.kind, kind),
      or(
        gt(e.occurredAt, occurredAt),
        and(eq(e.occurredAt, occurredAt), sql`lower(${e.id}::text) > ${eventId.toLowerCase()}`),
      ),
    ))
    .limit(1);
  return later.length > 0;
}

module.exports = { isSuperseded };
