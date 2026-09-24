// Storing the iOS app's MetricKit reports (POST /api/diagnostics/metrickit,
// server/routes/diagnostics.js; contract in server/contracts/diagnostics.js).
//
// A report is Apple's own JSON, stored as sent apart from two things:
//   - scrubPayload() drops the few fields that say something about the person
//     rather than the app (DROPPED_KEYS), and NUL characters, which Postgres
//     jsonb refuses (a report with one would otherwise be a 500 on every retry);
//   - nesting past MAX_DEPTH is refused, so a hostile body can't make the walk
//     expensive. Call-stack trees nest one level per frame, hence the headroom.
//
// Retention is enforced by the insert itself, the way rate_limits sweeps its own
// expired rows: each insert deletes up to SWEEP_BATCH reports older than
// RETENTION_DAYS, oldest first. No timer, no cron.
const { sql } = require('drizzle-orm');

const RETENTION_DAYS = 90;
const SWEEP_BATCH = 100;
const MAX_DEPTH = 2000;

// Keys removed wherever they appear. `regionFormat` is the device's region
// setting (e.g. "US") — not needed to fix a crash, and the privacy label does
// not declare location of any kind.
const DROPPED_KEYS = new Set(['regionFormat']);

class PayloadTooDeepError extends Error {}

// → a scrubbed deep copy of `payload`; throws PayloadTooDeepError past MAX_DEPTH.
// Iterative, so depth is bounded by MAX_DEPTH and not by the JS stack.
function scrubPayload(payload) {
  const clean = value => (typeof value === 'string' ? value.replaceAll('\u0000', '') : value);
  const root = Array.isArray(payload) ? [] : {};
  const stack = [{ from: payload, to: root, depth: 1 }];
  while (stack.length) {
    const { from, to, depth } = stack.pop();
    if (depth > MAX_DEPTH) throw new PayloadTooDeepError(`payload is nested more than ${MAX_DEPTH} levels deep`);
    const entries = Array.isArray(from) ? from.map((v, i) => [i, v]) : Object.entries(from);
    for (const [key, value] of entries) {
      if (typeof key === 'string' && DROPPED_KEYS.has(key)) continue;
      const outKey = typeof key === 'string' ? clean(key) : key;
      if (value && typeof value === 'object') {
        const child = Array.isArray(value) ? [] : {};
        to[outKey] = child;
        stack.push({ from: value, to: child, depth: depth + 1 });
      } else {
        to[outKey] = clean(value);
      }
    }
  }
  return root;
}

// Stores one report (already validated against MetricKitUploadRequest) and
// sweeps expired ones, in one statement. A resend of a stored id changes
// nothing. `exec` is `db` or a transaction.
async function storeMetricKitPayload(exec, { id, kind, app_version: appVersion, os_version: osVersion, payload }) {
  const scrubbed = scrubPayload(payload);
  const json = JSON.stringify(scrubbed);
  await exec.execute(sql`
    WITH dead AS (
      DELETE FROM metrickit_payloads
      WHERE id IN (
        SELECT id FROM metrickit_payloads
        WHERE received_at < now() - make_interval(days => ${RETENTION_DAYS})
        ORDER BY received_at
        LIMIT ${SWEEP_BATCH}
      )
    )
    INSERT INTO metrickit_payloads (id, kind, app_version, os_version, payload, payload_bytes)
    VALUES (${id}, ${kind}, ${appVersion}, ${osVersion}, ${json}::jsonb, ${Buffer.byteLength(json)})
    ON CONFLICT (id) DO NOTHING
  `);
}

module.exports = {
  scrubPayload,
  storeMetricKitPayload,
  PayloadTooDeepError,
  DROPPED_KEYS,
  RETENTION_DAYS,
  SWEEP_BATCH,
  MAX_DEPTH,
};
