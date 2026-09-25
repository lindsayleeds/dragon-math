// Contract for the parent's children routes in server/routes/parent.js that the
// iOS parent view calls: list the linked kids, create a new one (the web
// dashboard uses the same two routes), turn a kid's telemetry off or on, set a
// kid's game pace, and one child's summary stats (iOS only; the web drill-in reads the larger
// /stats payload).
//
// Creating a child is gated by the parent's plan (child_limit, resolved through
// server/lib/planStatus.js): at the limit the route answers 402 with a
// ChildLimitError the app shows as is.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');

// Same limit and message as PATCH /api/parent/children/:childId.
const REAL_NAME_MAX_LEN = 80;
const NAME_TOO_LONG = `Name must be at most ${REAL_NAME_MAX_LEN} characters.`;

const CreateChildRequest = z
  .object({
    real_name: z
      .string({ error: 'real_name must be a string' })
      .trim()
      .max(REAL_NAME_MAX_LEN, { error: NAME_TOO_LONG })
      .optional()
      .meta({
        description: "The child's name as the parent knows them. Adult-facing; empty or absent leaves it unset.",
      }),
  })
  .meta({ id: 'CreateChildRequest' });

const CreatedChild = z
  .object({
    id: z.number().int().meta({ description: "The server's child id." }),
    username: z.string().nullable().meta({ description: 'Null: the child picks their own handle on first sign-in.' }),
    real_name: z.string().nullable(),
    avatar: z.string(),
    current_node_id: z.number().int(),
    needs_handle: z.boolean(),
    login_token: z.string().meta({ description: 'Secret for the /k/<login_token> sign-in link and QR code.' }),
  })
  .meta({ id: 'CreatedChild' });

const CreateChildResponse = z.object({ child: CreatedChild }).meta({ id: 'CreateChildResponse' });

const ChildLimitError = z
  .object({
    error: z.string().meta({ description: 'Human-readable message, safe to show a parent.' }),
    code: z.string().meta({ description: 'child_limit.' }),
    plan: z.string().meta({ description: "The parent's plan in effect: free, premium or classroom." }),
    limit: z.number().int().nullable().meta({ description: 'Children allowed on that plan; null = unlimited.' }),
  })
  .meta({ id: 'ChildLimitError' });

// The game pace (src/rules/pace.js, which pace.test.js checks this against):
// how fast the clocks a kid races against run in battles and Dragon Munchers.
const GAME_PACES = ['normal', 'slow', 'off'];
const GamePace = z.enum(GAME_PACES).meta({
  id: 'GamePace',
  description: "normal; slow (the opponent and the Munchers monsters run at half speed); off (untimed: no "
    + 'opponent clock and no monsters).',
});

const LinkedChild = z
  .object({
    id: z.number().int(),
    username: z.string().meta({
      description: 'The handle, or a placeholder while needs_handle is true (show real_name or a generic label instead).',
    }),
    real_name: z.string().nullable(),
    avatar: z.string(),
    current_node_id: z.number().int(),
    created_at: z.string().nullable().meta({ description: 'ISO timestamp.' }),
    needs_handle: z.boolean(),
    login_token: z.string().nullable(),
    last_attempt_at: z.string().nullable().meta({ description: 'ISO timestamp of the latest play; null if never.' }),
    minutes_today: z.number().int(),
    minutes_7d: z.number().int(),
    telemetry_opt_out: z.boolean().meta({
      description: 'True when the parent turned telemetry off: the app syncs only progress for this child.',
    }),
    game_pace: GamePace,
  })
  .meta({ id: 'LinkedChild' });

const ChildrenResponse = z.object({ children: z.array(LinkedChild) }).meta({ id: 'ChildrenResponse' });

const ChildIdParams = z.object({
  childId: z.string().meta({ description: "The child's server id." }),
});

// Telemetry is how the kid played (attempts, wrong taps, matches, playtime —
// TELEMETRY_KINDS in ./sync.js), as opposed to progress, which always syncs.
const ChildTelemetryRequest = z
  .object({
    telemetry_opt_out: z
      .boolean({ error: 'telemetry_opt_out must be true or false' })
      .meta({ description: "True turns this child's telemetry off; false turns it back on." }),
  })
  .meta({ id: 'ChildTelemetryRequest' });

const ChildTelemetryResponse = z
  .object({
    id: z.number().int(),
    telemetry_opt_out: z.boolean(),
  })
  .meta({ id: 'ChildTelemetryResponse' });

const ChildPaceRequest = z
  .object({
    game_pace: z
      .enum(GAME_PACES, { error: `game_pace must be one of ${GAME_PACES.join(', ')}` })
      .meta({ description: "The child's new game pace." }),
  })
  .meta({ id: 'ChildPaceRequest' });

const ChildPaceResponse = z
  .object({
    id: z.number().int(),
    game_pace: GamePace,
  })
  .meta({ id: 'ChildPaceResponse' });

// The summary route coerces the id to a number, so the Swift client takes an Int.
const ChildSummaryParams = z.object({
  childId: z.coerce.number().int().positive().meta({ description: "A linked child's server id." }),
});

const ChildPlaySummary = z
  .object({
    minutes_today: z.number().int().meta({ description: "Active minutes on the server's local calendar day." }),
    minutes_7d: z.number().int().meta({ description: 'Active minutes today and the six days before it.' }),
    minutes_total: z.number().int().meta({ description: 'Active minutes, all time.' }),
    last_played_at: z.string().nullable().meta({ description: 'ISO timestamp of the latest play; null if never.' }),
  })
  .meta({ id: 'ChildPlaySummary' });

const ChildProgressSummary = z
  .object({
    current_node_id: z.number().int().meta({ description: 'The map frontier: the furthest node unlocked.' }),
    nodes_won: z.number().int(),
    stars: z.number().int().meta({ description: 'Best stars summed over every node won (up to 3 each).' }),
    three_star_nodes: z.number().int(),
  })
  .meta({ id: 'ChildProgressSummary' });

const ChildDragonSummary = z
  .object({
    kinds: z.number().int().meta({ description: 'Different dragons caught.' }),
    total: z.number().int().meta({ description: 'Dragons caught, counting repeats.' }),
  })
  .meta({ id: 'ChildDragonSummary' });

const OperatorStat = z
  .object({
    operator: z.string().meta({ description: 'add, sub, mul or div.' }),
    total: z.number().int().meta({ description: 'Problems answered in the window.' }),
    child_wins: z.number().int().meta({ description: 'Solved before the dragon.' }),
    accuracy: z.number().meta({ description: 'child_wins / total, 0–1.' }),
    avg_child_ms: z.number().nullable().meta({ description: 'Average time to a solve; null with no solves.' }),
  })
  .meta({ id: 'OperatorStat' });

const ChildMasterySummary = z
  .object({
    window_days: z.number().int().meta({ description: 'The rolling window these figures cover.' }),
    min_attempts: z.number().int().meta({ description: 'Answers an operation needs to be called strongest or weakest.' }),
    operators: z.array(OperatorStat).meta({ description: 'Each operation practised in the window.' }),
    strongest: z.string().nullable().meta({ description: 'Best operation by accuracy, then pace; null without enough play.' }),
    weakest: z.string().nullable().meta({ description: 'Least accurate operation; null unless worse than the strongest.' }),
  })
  .meta({ id: 'ChildMasterySummary' });

const ChildSummaryResponse = z
  .object({
    child_id: z.number().int(),
    play: ChildPlaySummary,
    progress: ChildProgressSummary,
    dragons: ChildDragonSummary,
    mastery: ChildMasterySummary,
  })
  .meta({
    id: 'ChildSummaryResponse',
    description: "One child's stats from everything the server has recorded, on every device — offline play "
      + 'counts once it has synced.',
  });

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/parent/children',
    operationId: 'listChildren',
    summary: "The signed-in parent's linked children, by username",
    tags: ['family'],
    auth: true,
    responses: {
      200: { description: 'The linked children.', schema: ChildrenResponse },
      ...errors(401, 403),
    },
  }),
  defineRoute({
    method: 'post',
    path: '/api/parent/children',
    operationId: 'createChild',
    summary: "Create a new child account linked to the signed-in parent, within the plan's child limit",
    tags: ['family'],
    auth: true,
    body: CreateChildRequest,
    responses: {
      201: { description: 'The new child.', schema: CreateChildResponse },
      402: { description: "At the plan's child limit.", schema: ChildLimitError },
      ...errors(400, 401, 403, 429),
    },
  }),
  defineRoute({
    method: 'put',
    path: '/api/parent/children/{childId}/telemetry',
    operationId: 'setChildTelemetry',
    summary: "Turn a linked child's telemetry off or on. Progress keeps syncing either way.",
    tags: ['family'],
    auth: true,
    params: ChildIdParams,
    body: ChildTelemetryRequest,
    responses: {
      200: { description: 'The setting now in effect.', schema: ChildTelemetryResponse },
      ...errors(400, 401, 403),
    },
  }),
  defineRoute({
    method: 'put',
    path: '/api/parent/children/{childId}/pace',
    operationId: 'setChildPace',
    summary: "Set a linked child's game pace: normal, slow, or off (untimed battles and Munchers).",
    tags: ['family'],
    auth: true,
    params: ChildIdParams,
    body: ChildPaceRequest,
    responses: {
      200: { description: 'The pace now in effect.', schema: ChildPaceResponse },
      ...errors(400, 401, 403),
    },
  }),
  defineRoute({
    method: 'get',
    path: '/api/parent/children/{childId}/summary',
    operationId: 'getChildSummary',
    summary: "A linked child's recent play, progress, dragons and strongest and weakest operations",
    tags: ['family'],
    auth: true,
    params: ChildSummaryParams,
    responses: {
      200: { description: 'The summary.', schema: ChildSummaryResponse },
      ...errors(400, 401, 403, 404),
    },
  }),
];

module.exports = {
  routes, REAL_NAME_MAX_LEN, CreateChildRequest, ChildLimitError, LinkedChild, ChildTelemetryRequest,
  ChildPaceRequest, GAME_PACES, GamePace,
};
