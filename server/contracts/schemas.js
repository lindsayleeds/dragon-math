// Shared response shapes for the HTTP contract (see ./index.js).
//
// Every schema that appears in more than one place carries `.meta({ id })`, which
// is what names it as a component in openapi.json — swift-openapi-generator turns
// each id into a Swift type, so an id is part of the iOS API: rename one only
// together with the Swift code that uses it.
//
// Response schemas are deliberately open (no `additionalProperties: false`): the
// generated Swift client would otherwise refuse a response carrying a field added
// after that app build shipped. Tests still catch an undocumented field — see
// server/openapi/contract.js — so openness never hides drift here.
//
// Values the server stores as free text (plan, font, avatar, adult_role) are
// strings rather than enums in RESPONSES for the same reason: a Swift enum fails
// to decode a value it has never seen. Inputs are where enums are enforced.
const { z } = require('zod');

const ErrorResponse = z
  .object({ error: z.string().meta({ description: 'Human-readable message, safe to show a kid or parent.' }) })
  .meta({ id: 'ErrorResponse' });

const Entitlements = z
  .object({
    games_locked: z.array(z.string()).meta({ description: 'Game ids (src/data/games.js) the child cannot open on their plan.' }),
  })
  .meta({ id: 'Entitlements' });

const ChildUser = z
  .object({
    id: z.number().int(),
    username: z.string(),
    account_type: z.literal('child'),
    current_node_id: z.number().int(),
    avatar: z.string(),
    font: z.string(),
    dragon_trial_completed: z.boolean(),
    needs_handle: z.boolean(),
    effective_plan: z.string().meta({ description: "Highest plan among the child's guardians: free, premium or classroom." }),
    entitlements: Entitlements,
    family_mode: z.boolean().optional().meta({ description: 'Present and true when the session came from a shared family device.' }),
  })
  .meta({ id: 'ChildUser' });

const AdultUser = z
  .object({
    id: z.number().int(),
    username: z.string(),
    account_type: z.enum(['parent', 'admin']),
    email: z.string().nullable().meta({
      description: 'The login email. For a Sign in with Apple account it may be a private relay address.',
    }),
    email_verified: z.boolean(),
    contact_email: z.string().nullable().meta({
      description: 'Where progress digests and COPPA notices go. Null until the parent sets one.',
    }),
    contact_email_verified: z.boolean(),
    adult_role: z.string().meta({ description: 'parent or teacher.' }),
    plan: z.string().meta({ description: 'free, premium or classroom.' }),
  })
  .meta({ id: 'AdultUser' });

const User = z.discriminatedUnion('account_type', [ChildUser, AdultUser]).meta({ id: 'User' });

const AuthSession = z
  .object({
    token: z.string().meta({ description: 'JWT for the Authorization: Bearer header. Valid for 30 days.' }),
    user: User,
  })
  .meta({ id: 'AuthSession' });

const UserResponse = z.object({ user: User }).meta({ id: 'UserResponse' });

module.exports = {
  ErrorResponse,
  Entitlements,
  ChildUser,
  AdultUser,
  User,
  AuthSession,
  UserResponse,
};
