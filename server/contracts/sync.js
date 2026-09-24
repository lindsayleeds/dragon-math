// Contract for the iOS offline event upload, POST /api/sync/events (ADR 0003).
//
// The app records everything a kid does as an event with a UUID it mints on the
// device, queues it locally, and uploads the queue in batches. The server
// dedupes by that UUID, so a batch is safe to send any number of times — see
// server/lib/syncEvents.js for the apply rules and the transaction semantics.
//
// Two layers of validation, on purpose:
//   - the ENVELOPE (`{ events: [...] }`, at most MAX_SYNC_BATCH) fails the whole
//     request with a 400 — nothing in it was looked at;
//   - each EVENT is judged on its own, so one malformed event is reported as
//     `rejected` in its result and never costs the others in the batch.
// SyncEventsRequest is the documented shape of a good batch; the handler parses
// the envelope with SyncBatchEnvelope and each event with SyncEvent.
//
// A kind the server does not know yet is stored and acknowledged (status
// `stored`), not rejected, so the app can queue new kinds before the server
// applies them. The payload schemas for the kinds it does apply are published as
// components (SyncAttemptPayload, …) so the Swift client gets a type to encode
// each one with; the event's own `payload` stays an open object.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');
const { ChildIdQuery } = require('./spelling');

const MAX_SYNC_BATCH = 100;

// Written without the `i` flag so the pattern survives into openapi.json intact.
// Swift's UUID().uuidString is upper case; Postgres stores either the same way.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KIND_RE = /^[a-z][a-z0-9_.-]{0,63}$/;

const Uuid = message => z.string({ error: message }).regex(UUID_RE, { error: message });
const Int = (name, { min } = {}) => {
  let s = z.number({ error: `${name} must be a whole number` }).int({ error: `${name} must be a whole number` });
  if (min !== undefined) s = s.min(min, { error: `${name} must be at least ${min}` });
  return s;
};
const TimeMs = z.number({ error: 'time_ms must be a number' }).min(0, { error: 'time_ms must not be negative' }).nullish()
  .meta({ description: 'How long the answer took, in milliseconds.' });
const Operator = z.enum(['add', 'sub', 'mul', 'div'], { error: 'operator must be add, sub, mul or div' });
const MatchId = Uuid('match_id must be a UUID').meta({
  description: 'The id the device minted for this match; match_started and match_ended share it.',
});

// ---------------------------------------------------------------- payloads

const SyncMatchStartedPayload = z
  .object({ match_id: MatchId, node_id: Int('node_id', { min: 1 }) })
  .meta({ id: 'SyncMatchStartedPayload', description: 'kind `match_started`. occurred_at is when the battle began.' });

const SyncMatchEndedPayload = z
  .object({
    match_id: MatchId,
    node_id: Int('node_id', { min: 1 }),
    outcome: z.enum(['child', 'ai', 'incomplete'], { error: 'outcome must be child, ai or incomplete' }),
    player_score: Int('player_score', { min: 0 }),
    ai_score: Int('ai_score', { min: 0 }),
  })
  .meta({
    id: 'SyncMatchEndedPayload',
    description: 'kind `match_ended`. occurred_at is when it resolved. A finished match keeps its result, '
      + 'except that a real result replaces `incomplete`.',
  });

const SyncAttemptPayload = z
  .object({
    node_id: Int('node_id', { min: 0 }).meta({ description: 'Story node, or 0 for practice games.' }),
    operand_a: Int('operand_a'),
    operand_b: Int('operand_b'),
    operator: Operator,
    answer: Int('answer'),
    outcome: z.enum(['child', 'ai'], { error: 'outcome must be child or ai' })
      .meta({ description: 'Who got the problem: the kid, or the opponent.' }),
    time_ms: TimeMs,
  })
  .meta({ id: 'SyncAttemptPayload', description: 'kind `attempt`: one answered problem.' });

const SyncWrongTapPayload = z
  .object({
    node_id: Int('node_id', { min: 0 }),
    operand_a: Int('operand_a'),
    operand_b: Int('operand_b'),
    operator: Operator,
    correct_answer: Int('correct_answer'),
    tapped_value: Int('tapped_value'),
    time_ms: TimeMs,
  })
  .meta({ id: 'SyncWrongTapPayload', description: 'kind `wrong_tap`: a wrong answer the kid tapped.' });

const SyncNodeWonPayload = z
  .object({
    node_id: Int('node_id', { min: 1 }),
    stars: Int('stars', { min: 0 }).max(3, { error: 'stars must be at most 3' }),
  })
  .meta({
    id: 'SyncNodeWonPayload',
    description: 'kind `node_won`. The best stars and the first completion are kept, in whatever order wins arrive.',
  });

const SyncDragonsCollectedPayload = z
  .object({
    dragon_ids: z
      .array(Int('dragon_ids[]', { min: 1 }), { error: 'dragon_ids must be an array' })
      .min(1, { error: 'dragon_ids must not be empty' })
      .max(50, { error: 'At most 50 dragons per event' })
      .meta({ description: 'Dragons won; repeat an id to award it twice. Ids not in the catalog are skipped.' }),
  })
  .meta({ id: 'SyncDragonsCollectedPayload', description: 'kind `dragons_collected`.' });

const SyncPlaytimePayload = z
  .object({
    minutes: Int('minutes', { min: 1 }).max(240, { error: 'minutes must be at most 240' })
      .meta({ description: 'Consecutive active minutes starting at occurred_at.' }),
  })
  .meta({ id: 'SyncPlaytimePayload', description: 'kind `playtime`: minutes the kid was actively playing.' });

// The kinds this server applies, and the payload each must carry.
const SYNC_PAYLOADS = Object.freeze({
  match_started: SyncMatchStartedPayload,
  match_ended: SyncMatchEndedPayload,
  attempt: SyncAttemptPayload,
  wrong_tap: SyncWrongTapPayload,
  node_won: SyncNodeWonPayload,
  dragons_collected: SyncDragonsCollectedPayload,
  playtime: SyncPlaytimePayload,
});

// ---------------------------------------------------------------- request

const SyncEvent = z
  .object({
    id: Uuid('id must be a UUID').meta({ description: 'Minted on the device; the dedupe key. Never reuse one.' }),
    child_id: Int('child_id', { min: 1 }).meta({
      description: 'Whose event this is. A kid session may only send its own id; a grown-up, a linked child.',
    }),
    kind: z
      .string({ error: 'kind must be a string' })
      .regex(KIND_RE, { error: 'kind must be lower-case letters, digits, _ . or -' })
      .meta({ description: `One of ${Object.keys(SYNC_PAYLOADS).join(', ')}; any other kind is stored but not applied.` }),
    occurred_at: z.iso
      .datetime({ offset: true, error: 'occurred_at must be an ISO 8601 date-time' })
      .meta({ description: 'When it happened on the device. A time in the future is recorded as now.' }),
    payload: z
      .record(z.string(), z.unknown(), { error: 'payload must be an object' })
      .meta({ description: 'The kind-specific fields — see the Sync*Payload schemas.' }),
  })
  .meta({ id: 'SyncEvent' });

const SyncEventsRequest = z
  .object({ events: z.array(SyncEvent).min(1).max(MAX_SYNC_BATCH) })
  .meta({ id: 'SyncEventsRequest', description: `1–${MAX_SYNC_BATCH} events, oldest first by convention; any order is accepted.` });

const SyncBatchEnvelope = z.object({
  events: z
    .array(z.unknown(), { error: 'events must be an array' })
    .min(1, { error: 'events must not be empty' })
    .max(MAX_SYNC_BATCH, { error: `At most ${MAX_SYNC_BATCH} events per request` }),
});

// ---------------------------------------------------------------- response

const SyncEventResult = z
  .object({
    index: z.number().int().meta({ description: 'Position of the event in the request.' }),
    id: z.string().nullable().meta({ description: 'The event id as sent, or null when it had none.' }),
    status: z.string().meta({
      description: 'applied (written), stored (kept, kind not applied yet), duplicate (already received), '
        + 'rejected (will never be accepted; see reason), failed (server error; resend later). '
        + 'A string rather than an enum so a new status cannot break an older app — act on `acknowledged`.',
    }),
    acknowledged: z.boolean().meta({
      description: 'True when the server is done with this event and the device may delete it. Only `failed` is false.',
    }),
    reason: z.string().optional().meta({
      description: 'For rejected and failed: a stable code (invalid_event, invalid_payload, not_your_child, '
        + 'id_conflict, not_your_match, unknown_dragons, invalid_data, server_error).',
    }),
    message: z.string().optional().meta({ description: 'For rejected and failed: human-readable detail.' }),
  })
  .meta({ id: 'SyncEventResult' });

const SyncEventsResponse = z
  .object({ results: z.array(SyncEventResult).meta({ description: 'One per event, in request order.' }) })
  .meta({ id: 'SyncEventsResponse' });

// ---------------------------------------------------------------- progress

const SyncProgressNode = z
  .object({
    node_id: z.number().int(),
    stars: z.number().int().meta({ description: 'Best stars earned on the node, 0–3.' }),
  })
  .meta({ id: 'SyncProgressNode' });

const SyncProgressDragon = z
  .object({
    dragon_id: z.number().int(),
    count: z.number().int().meta({ description: 'How many of this dragon the child has caught, on every device.' }),
  })
  .meta({ id: 'SyncProgressDragon' });

const SyncProgressResponse = z
  .object({
    child_id: z.number().int(),
    current_node_id: z.number().int().meta({ description: 'The map frontier: the furthest node unlocked.' }),
    nodes: z.array(SyncProgressNode).meta({ description: 'Every node won, in node_id order.' }),
    dragons: z.array(SyncProgressDragon).meta({ description: 'Every dragon caught, in dragon_id order.' }),
    play_minutes: z.number().int().meta({ description: 'Active minutes played, all time.' }),
  })
  .meta({
    id: 'SyncProgressResponse',
    description: 'Everything the server has recorded for the child, from every device. Includes every event '
      + 'acknowledged before this was read.',
  });

const routes = [
  defineRoute({
    method: 'post',
    path: '/api/sync/events',
    operationId: 'uploadSyncEvents',
    summary: 'Upload queued offline events. Safe to resend: events are deduped by id.',
    tags: ['sync'],
    auth: true,
    body: SyncEventsRequest,
    responses: {
      200: { description: 'Per-event results. Delete every acknowledged event from the queue.', schema: SyncEventsResponse },
      ...errors(400, 401, 429),
    },
  }),
  defineRoute({
    method: 'get',
    path: '/api/sync/progress',
    operationId: 'getSyncProgress',
    summary: "A child's progress as the server has it, merged from all of their devices.",
    tags: ['sync'],
    auth: true,
    query: ChildIdQuery,
    responses: {
      200: { description: 'The progress.', schema: SyncProgressResponse },
      ...errors(400, 401, 403),
    },
  }),
];

// Schemas no route references directly but the app needs a type for.
const components = [
  SyncMatchStartedPayload,
  SyncMatchEndedPayload,
  SyncAttemptPayload,
  SyncWrongTapPayload,
  SyncNodeWonPayload,
  SyncDragonsCollectedPayload,
  SyncPlaytimePayload,
];

module.exports = {
  routes,
  components,
  MAX_SYNC_BATCH,
  SYNC_PAYLOADS,
  SyncEvent,
  SyncBatchEnvelope,
  SyncEventsRequest,
  SyncEventsResponse,
  SyncProgressResponse,
};
