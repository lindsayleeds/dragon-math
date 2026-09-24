// Contract for the parent's children routes in server/routes/parent.js that the
// iOS parent view calls: list the linked kids, and create a new one. The web
// dashboard uses the same two routes.
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
  })
  .meta({ id: 'LinkedChild' });

const ChildrenResponse = z.object({ children: z.array(LinkedChild) }).meta({ id: 'ChildrenResponse' });

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
];

module.exports = { routes, REAL_NAME_MAX_LEN, CreateChildRequest, ChildLimitError, LinkedChild };
