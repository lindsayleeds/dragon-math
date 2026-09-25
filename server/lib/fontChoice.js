// The kid's font theme (users.font — the column the web's Settings page writes
// through PUT /api/auth/profile) set from the iOS sync upload, kind
// `font_chosen`. Takes the executor first and never opens a transaction of its
// own (as ./playRecords.js).
const { eq } = require('drizzle-orm');
const schema = require('../db/schema');
const { isSuperseded } = require('./latestChoice');

// For a `font_chosen` event whose sync_events row is already inserted in
// `exec`'s transaction: the font becomes the kid's only if no other
// font_chosen event for them is later (./latestChoice.js), so the end state
// doesn't depend on upload order. A choice made on the web since has no time
// to compare, and is replaced by the next synced choice that is the latest.
async function chooseFontSynced(exec, { userId, font, eventId, occurredAt }) {
  if (await isSuperseded(exec, { userId, kind: 'font_chosen', eventId, occurredAt })) return 'superseded';
  await exec.update(schema.users).set({ font }).where(eq(schema.users.id, userId));
  return 'active';
}

module.exports = { chooseFontSynced };
