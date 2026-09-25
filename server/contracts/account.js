// Contract for POST /api/account/delete (server/routes/account.js): a parent
// deletes their account and their children's data from the iOS app (App Store
// Review Guideline 5.1.1(v)). What is deleted, unlinked or anonymized is
// server/lib/accountDeletion.js; revoking the Apple grant is
// server/lib/appleRevoke.js.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');

const REAUTH = 'Sign in with Apple again to delete your account.';

const DeleteAccountRequest = z
  .object({
    identity_token: z
      .string({ error: REAUTH })
      .trim()
      .min(1, { error: REAUTH })
      .max(8192, { error: REAUTH })
      .meta({
        description: 'A FRESH identityToken from ASAuthorizationAppleIDCredential. Its sub must be the '
          + "signed-in parent's Apple ID: re-authenticating is the confirmation.",
      }),
    nonce: z
      .string({ error: 'Invalid nonce' })
      .min(1, { error: 'Invalid nonce' })
      .max(256, { error: 'Invalid nonce' })
      .optional()
      .meta({ description: 'The RAW nonce, as for POST /api/auth/apple.' }),
    authorization_code: z
      .string({ error: 'Invalid authorization code' })
      .trim()
      .min(1, { error: 'Invalid authorization code' })
      .max(4096, { error: 'Invalid authorization code' })
      .optional()
      .meta({
        description: "The same credential's authorizationCode. The server trades it for a token and revokes it, "
          + "ending this app's Sign in with Apple grant. Without it the account is still deleted.",
      }),
  })
  .meta({ id: 'DeleteAccountRequest' });

const DeleteAccountResponse = z
  .object({
    deleted_child_ids: z.array(z.number().int()).meta({
      description: 'Children deleted with the account: they had no other parent.',
    }),
    unlinked_child_ids: z.array(z.number().int()).meta({
      description: 'Children kept because another parent is linked to them; this parent is only unlinked.',
    }),
    apple_token_revoked: z.boolean().meta({
      description: 'Whether the Sign in with Apple grant was revoked. False when the server is not configured '
        + 'for it or Apple refused; the parent can still remove the app under Settings > Apple Account.',
    }),
  })
  .meta({ id: 'DeleteAccountResponse' });

const routes = [
  defineRoute({
    method: 'post',
    path: '/api/account/delete',
    operationId: 'deleteParentAccount',
    summary: "Permanently delete the signed-in parent's account and every child who has no other parent.",
    tags: ['account'],
    auth: true,
    body: DeleteAccountRequest,
    responses: {
      200: { description: 'Deleted. Every session for the account is now useless.', schema: DeleteAccountResponse },
      ...errors(400, 401, 403, 404, 502, 503),
    },
  }),
];

module.exports = { routes, DeleteAccountRequest };
