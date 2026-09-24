// Applying a batch of offline events from the iOS app (ADR 0003). The route is
// server/routes/sync.js; the wire contract, including each kind's payload, is
// server/contracts/sync.js.
//
// THE GUARANTEES, and how they are kept:
//
//  - Safe to resend. The device's UUID is the primary key of sync_events, and an
//    event's row there is inserted in the SAME transaction that applies it to the
//    play tables. A resent event finds its row and is reported `duplicate`
//    without touching anything. Two uploads of one event racing each other
//    serialize on that key: the second waits for the first to commit, then sees
//    a duplicate (or, if the first rolled back, applies it itself).
//
//  - One transaction per EVENT, not per batch. Each result the response reports
//    is already durable when it is reported, and an event that fails rolls back
//    alone — its dedupe row with it, so it is not mistaken for a duplicate when
//    resent — while the events around it still apply. A batch is therefore never
//    all-or-nothing, and the per-event `acknowledged` flag is what the device
//    acts on: delete what is acknowledged, keep and resend the rest.
//
//  - Order doesn't matter. Events are applied in request order, but each kind's
//    write gives the same end state whichever order events arrive in, within a
//    batch or across batches (see the sync variants in ./playRecords.js): a
//    match's start and end meet on one row by the device's match id, node wins
//    keep the best stars, dragon counts and attempt rows simply add up.
//
//  - Rejected means never. `rejected` is for an event that no resend could fix —
//    malformed, for a child the caller may not touch, or refused by a table
//    constraint — so the device drops it rather than retrying forever. Anything
//    else that goes wrong (the database is unreachable, a statement times out)
//    is `failed`, unacknowledged, and the device tries again later. Rejected
//    events are not stored.
//
//  - Unknown kinds are kept. A kind this server has no payload schema for is
//    stored with `applied = false` and acknowledged (`stored`), so the app can
//    queue kinds ahead of the server and a later server can apply them from the
//    table.
//
// Rewards and progress are the device's call (ADR 0004): nothing here second-
// guesses a win or a prize beyond its shape. The one adjustment is the clock —
// an occurred_at in the future is recorded as now, so a wrong device clock
// can't put play into days that haven't happened.
const { eq } = require('drizzle-orm');
const schema = require('../db/schema');
const { SyncEvent, SYNC_PAYLOADS } = require('../contracts/sync');
const { localMinuteNow } = require('./localTime');
const records = require('./playRecords');

const MINUTE_MS = 60 * 1000;

// Thrown inside an event's transaction to roll it back and report `rejected`.
class Rejection extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// Each applier writes one event through the shared play-record helpers, inside
// the event's transaction, and throws a Rejection for an event that can never
// apply. `ctx` is { userId, at } — the child it belongs to, and when it
// happened (already clamped to now).
const APPLIERS = {
  async match_started(tx, { userId, at }, p) {
    const result = await records.recordMatchStart(tx, {
      userId, clientMatchId: p.match_id, nodeId: p.node_id, startedAt: at,
    });
    if (result === 'forbidden') throw new Rejection('not_your_match', 'That match_id belongs to someone else.');
  },

  async match_ended(tx, { userId, at }, p) {
    const result = await records.recordMatchEnd(tx, {
      userId,
      clientMatchId: p.match_id,
      nodeId: p.node_id,
      outcome: p.outcome,
      playerScore: p.player_score,
      aiScore: p.ai_score,
      endedAt: at,
    });
    if (result === 'forbidden') throw new Rejection('not_your_match', 'That match_id belongs to someone else.');
  },

  async attempt(tx, { userId, at }, p) {
    await records.insertAttempts(tx, [records.attemptRow(userId, p, at)], []);
  },

  async wrong_tap(tx, { userId, at }, p) {
    await records.insertAttempts(tx, [], [records.wrongTapRow(userId, p, at)]);
  },

  async node_won(tx, { userId, at }, p) {
    await records.recordNodeWin(tx, { userId, nodeId: p.node_id, stars: p.stars, completedAt: at, keepBest: true });
  },

  // Ids that are not in the catalog at all are skipped, as the web route skips
  // them; an event with none left is rejected. Retired dragons still count —
  // see catalogDragonIds().
  async dragons_collected(tx, { userId, at }, p) {
    const known = await records.catalogDragonIds(tx);
    const ids = p.dragon_ids.filter(id => known.has(id));
    if (!ids.length) throw new Rejection('unknown_dragons', 'None of those dragons are in the catalog.');
    await records.addDragons(tx, userId, ids, at);
  },

  async playtime(tx, { userId, at }, p) {
    const minutes = [];
    for (let i = 0; i < p.minutes; i++) minutes.push(localMinuteNow(new Date(at.getTime() + i * MINUTE_MS)));
    await records.recordPlayMinutes(tx, userId, minutes);
  },
};

// Every kind with a payload schema must have an applier, and vice versa.
for (const kind of new Set([...Object.keys(SYNC_PAYLOADS), ...Object.keys(APPLIERS)])) {
  if (!SYNC_PAYLOADS[kind] || !APPLIERS[kind]) throw new Error(`sync kind ${kind} needs both a payload schema and an applier`);
}

function firstIssue(error) {
  const issue = error.issues[0];
  if (!issue) return 'Invalid event';
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

// Postgres SQLSTATE classes 22 (data exception) and 23 (integrity constraint
// violation) mean this event's values can't be stored, which no resend changes.
function isPermanentDbError(err) {
  const code = err?.code ?? err?.cause?.code;
  return typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'));
}

const result = (index, id, status, extra = {}) => ({
  index,
  id,
  status,
  acknowledged: status !== 'failed',
  ...extra,
});
const rejected = (index, id, reason, message) => result(index, id, 'rejected', { reason, message });
const failed = (index, id) => result(index, id, 'failed', {
  reason: 'server_error',
  message: 'Something went wrong. Send it again later.',
});

// Apply one event. Never throws: every outcome is a result.
async function applyEvent({ exec, user, raw, index, childAccess, now }) {
  const sentId = typeof raw?.id === 'string' ? raw.id : null;

  const parsed = SyncEvent.safeParse(raw);
  if (!parsed.success) return rejected(index, sentId, 'invalid_event', firstIssue(parsed.error));
  const event = parsed.data;

  let childId;
  try {
    childId = await childAccess(event.child_id);
  } catch (err) {
    console.error(`sync event ${event.id}: child access check failed:`, err);
    return failed(index, sentId);
  }
  if (!childId) return rejected(index, sentId, 'not_your_child', 'You can only send events for your own account or a linked child.');

  const payloadSchema = SYNC_PAYLOADS[event.kind];
  let payload = event.payload;
  if (payloadSchema) {
    const p = payloadSchema.safeParse(event.payload);
    if (!p.success) return rejected(index, sentId, 'invalid_payload', firstIssue(p.error));
    payload = p.data;
  }

  const at = new Date(Math.min(Date.parse(event.occurred_at), now));

  try {
    const status = await exec.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.syncEvents)
        .values({
          id: event.id,
          userId: childId,
          submittedBy: user.id,
          kind: event.kind,
          // As the device sent it, unclamped: a clock far off is itself worth
          // being able to see.
          occurredAt: new Date(event.occurred_at),
          payload: event.payload,
          applied: !!payloadSchema,
        })
        .onConflictDoNothing()
        .returning({ id: schema.syncEvents.id });

      if (!inserted.length) {
        const [existing] = await tx
          .select({ userId: schema.syncEvents.userId })
          .from(schema.syncEvents)
          .where(eq(schema.syncEvents.id, event.id))
          .limit(1);
        // The same id for a different child is not a resend of this event, and
        // saying "duplicate" would let the device drop an event nobody stored.
        if (existing && existing.userId !== childId) {
          throw new Rejection('id_conflict', 'That event id was already used for another child.');
        }
        return 'duplicate';
      }

      if (!payloadSchema) return 'stored';
      await APPLIERS[event.kind](tx, { userId: childId, at }, payload);
      return 'applied';
    });
    return result(index, sentId, status);
  } catch (err) {
    if (err instanceof Rejection) return rejected(index, sentId, err.reason, err.message);
    if (isPermanentDbError(err)) {
      return rejected(index, sentId, 'invalid_data', 'The server could not store that event.');
    }
    console.error(`sync event ${event.id} (${event.kind}) for user ${childId} failed:`, err);
    return failed(index, sentId);
  }
}

// Apply a batch for `user` (req.user). `resolveChild(user, childId)` answers
// which child the caller may write for — ./childAccess.js in production. It is
// asked once per distinct child_id in the batch.
// → one result per event, in request order.
async function applySyncBatch({ exec, user, events, resolveChild, now = Date.now() }) {
  const access = new Map();
  const childAccess = (childId) => {
    if (!access.has(childId)) access.set(childId, resolveChild(user, childId));
    return access.get(childId);
  };

  const results = [];
  for (let index = 0; index < events.length; index++) {
    results.push(await applyEvent({ exec, user, raw: events[index], index, childAccess, now }));
  }
  return results;
}

module.exports = { applySyncBatch, isPermanentDbError };
