// What the server knows of a child's progress, for GET /api/sync/progress — the
// read half of the iOS sync (ADR 0003). After a device uploads its queue it
// pulls this, so play recorded on the child's other devices (an iPhone and an
// iPad, say) shows up on this one. The device merges it with its own events
// (ios/Packages/Store): wins and stars by union and best, the frontier by max,
// and the additive counts — dragons, minutes — by taking these totals and
// adding only the local events not yet reflected in them.
//
// Everything the kid earned is here, flagged or not: this is the kid's own
// view (docs/PLAUSIBILITY.md).
const { sql } = require('drizzle-orm');

// → { current_node_id, nodes: [{ node_id, stars }], dragons: [{ dragon_id, count }], play_minutes }
async function childProgress(exec, userId) {
  const [user] = (await exec.execute(sql`
    SELECT current_node_id FROM users WHERE id = ${userId}
  `)).rows;
  const nodes = (await exec.execute(sql`
    SELECT node_id, COALESCE(stars, 0)::int AS stars
    FROM node_progress
    WHERE user_id = ${userId} AND completed
    ORDER BY node_id
  `)).rows;
  const dragons = (await exec.execute(sql`
    SELECT dragon_id, count
    FROM user_dragons
    WHERE user_id = ${userId} AND count > 0
    ORDER BY dragon_id
  `)).rows;
  const [{ minutes }] = (await exec.execute(sql`
    SELECT count(*)::int AS minutes FROM play_minutes WHERE user_id = ${userId}
  `)).rows;
  return {
    current_node_id: user?.current_node_id ?? 1,
    nodes,
    dragons,
    play_minutes: minutes,
  };
}

module.exports = { childProgress };
