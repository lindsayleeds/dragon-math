// Companion ids and the writes that change which companions a kid has and
// which one they take into battle — shared by the web routes
// (server/routes/companions.js) and the iOS sync upload (./syncEvents.js), so a
// companion the app picks lands in the same columns the web reads
// (users.active_companion_id, user_companions).
//
// Every function takes the executor first — `db`, or the `tx` of a transaction
// the caller owns — and never opens a transaction of its own (as ./playRecords.js).
const { and, eq, gt, or, sql } = require('drizzle-orm');
const schema = require('../db/schema');

// Boss node → companion id. Mirrors NODE_TO_COMPANION in src/data/companions.js.
// Source of truth for capture validation and self-healing backfill.
const BOSS_NODE_TO_COMPANION = Object.freeze({
  8:  'forest_dragon',
  16: 'sunfire_dragon',
  25: 'crystal_dragon',
  33: 'sakura_dragon',
  41: 'storm_dragon',
});
const BOSS_NODE_IDS = Object.keys(BOSS_NODE_TO_COMPANION).map(Number);
// Collection order, as COMPANIONS in src/data/companions.js.
const COMPANION_IDS = Object.freeze(['pip', ...Object.values(BOSS_NODE_TO_COMPANION)]);
const VALID_COMPANION_IDS = new Set(COMPANION_IDS);

// Gives the user a companion; a no-op if they have it.
function grantCompanion(exec, userId, companionId) {
  return exec
    .insert(schema.userCompanions)
    .values({ userId, companionId })
    .onConflictDoNothing();
}

// Whether the user has befriended the companion.
async function ownsCompanion(exec, userId, companionId) {
  const rows = await exec
    .select({ id: schema.userCompanions.id })
    .from(schema.userCompanions)
    .where(and(
      eq(schema.userCompanions.userId, userId),
      eq(schema.userCompanions.companionId, companionId),
    ))
    .limit(1);
  return rows.length > 0;
}

// Makes the companion the one the user takes into battle.
function setActiveCompanion(exec, userId, companionId) {
  return exec
    .update(schema.users)
    .set({ activeCompanionId: companionId })
    .where(eq(schema.users.id, userId));
}

// The sync variant, for a `companion_chosen` event whose sync_events row is
// already inserted in `exec`'s transaction. The device decides what a kid has
// befriended (ADR 0004), so the companion is granted along with Pip. It becomes
// active only if no other companion_chosen event for the user is later (by
// occurred_at, then id) — the same end state whichever order a queue uploads
// in. A choice made on the web since (PUT /api/companions/active, which has no
// time to compare) is replaced by the next synced choice that is the latest.
async function chooseCompanionSynced(exec, { userId, companionId, eventId, occurredAt }) {
  await grantCompanion(exec, userId, 'pip');
  await grantCompanion(exec, userId, companionId);

  const e = schema.syncEvents;
  const later = await exec
    .select({ id: e.id })
    .from(e)
    .where(and(
      eq(e.userId, userId),
      eq(e.kind, 'companion_chosen'),
      or(
        gt(e.occurredAt, occurredAt),
        and(eq(e.occurredAt, occurredAt), sql`lower(${e.id}::text) > ${eventId.toLowerCase()}`),
      ),
    ))
    .limit(1);
  if (later.length) return 'superseded';

  await setActiveCompanion(exec, userId, companionId);
  return 'active';
}

module.exports = {
  BOSS_NODE_TO_COMPANION,
  BOSS_NODE_IDS,
  COMPANION_IDS,
  VALID_COMPANION_IDS,
  grantCompanion,
  ownsCompanion,
  setActiveCompanion,
  chooseCompanionSynced,
};
