// Contract for GET /api/plan/status (server/routes/plan.js): one plan status per
// family, resolved from Stripe, App Store, comp and classroom grants (ADR 0008).
// The iOS app reads it to unlock premium and, for a parent, to get the
// appAccountToken it must pass to StoreKit when buying.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');

// Free text in responses, not enums — see ./schemas.js. Timestamps are plain
// ISO 8601 strings, not format: date-time: the server sends fractional seconds
// (toISOString()), which the Swift client's default date decoder rejects.
const PLAN = 'free, premium or classroom.';
const SOURCE = 'Where the grant comes from: stripe, app_store, comp, manual or classroom.';

const PlanGrant = z
  .object({
    source: z.string().meta({ description: SOURCE }),
    plan: z.string().meta({ description: PLAN }),
    expires_at: z.string().nullable().meta({
      description: 'ISO 8601 timestamp. When the grant ends or next renews; null when it does not expire.',
    }),
    will_renew: z.boolean().nullable().meta({ description: 'Whether it renews at expires_at; null when unknown or not applicable.' }),
  })
  .meta({ id: 'PlanGrant' });

const PlanEntitlements = z
  .object({
    games_locked: z.array(z.string()).meta({ description: 'Game ids (src/data/games.js) locked on this plan.' }),
    child_limit: z.number().int().nullable().meta({ description: 'Children an adult on this plan may have; null = unlimited.' }),
    can_use_digest: z.boolean(),
  })
  .meta({ id: 'PlanEntitlements' });

const PlanStatus = z
  .object({
    plan: z.string().meta({ description: `The plan in effect: ${PLAN} Highest grant wins.` }),
    source: z.string().nullable().meta({ description: `${SOURCE} Null on free.` }),
    expires_at: z.string().nullable().meta({ description: 'ISO 8601 timestamp. expires_at of the winning grant.' }),
    will_renew: z.boolean().nullable().meta({ description: 'will_renew of the winning grant.' }),
    grants: z.array(PlanGrant).meta({ description: 'Every paid grant in effect, best first. For a child, those of all their guardians.' }),
    entitlements: PlanEntitlements,
    app_account_token: z.string().nullable().meta({
      description:
        "UUID to pass as StoreKit's appAccountToken when this parent buys, so the App Store subscription is credited to this account. Null for kids.",
    }),
  })
  .meta({ id: 'PlanStatus' });

// A parent on a family iPad signs in once for every kid on it, but each kid's
// plan is their own: the best among all their guardians, classroom teachers
// included. child_id asks for that kid's.
const PlanStatusQuery = z.object({
  child_id: z.coerce
    .number({ error: 'child_id must be a positive integer' })
    .int({ error: 'child_id must be a positive integer' })
    .positive({ error: 'child_id must be a positive integer' })
    .optional()
    .meta({
      description:
        "A linked child's id: report that child's plan (the best among all their guardians, classroom teachers included) instead of the caller's own. A child may pass only their own id.",
    }),
});

const routes = [
  defineRoute({
    method: 'get',
    path: '/api/plan/status',
    operationId: 'getPlanStatus',
    summary: "The signed-in user's plan status, resolved across Stripe, App Store and classroom plans",
    tags: ['plan'],
    auth: true,
    query: PlanStatusQuery,
    responses: {
      200: { description: 'The resolved plan status.', schema: PlanStatus },
      ...errors(400, 401, 403),
    },
  }),
];

module.exports = { routes, PlanStatus, PlanStatusQuery, PlanGrant, PlanEntitlements };
