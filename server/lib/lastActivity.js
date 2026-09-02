const { sql } = require('drizzle-orm');

// play_minutes.minute is a wall-clock string in the server's timezone, while
// problem_attempts.created_at is timestamptz. Convert the former explicitly
// before comparing them so Postgres's own session timezone cannot shift it.
const SERVER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function lastActivityAt(userId) {
  return sql`GREATEST(
    (SELECT MAX(pa.created_at) FROM problem_attempts pa WHERE pa.user_id = ${userId}),
    (SELECT MAX(pm.minute)::timestamp AT TIME ZONE ${SERVER_TIMEZONE}
       FROM play_minutes pm WHERE pm.user_id = ${userId})
  )`;
}

module.exports = { lastActivityAt, SERVER_TIMEZONE };
