// Contract for a parent's contact email (server/routes/auth.js, ADR 0007): the
// address digests and COPPA notices go to, kept apart from the login email
// because Sign in with Apple may log a parent in with a private relay address.
// The iOS app asks for it after first sign-in and lets the parent change it from
// the parent view; each new address is verified through the same /parent/verify
// link as the sign-up email, which calls POST /api/auth/email/verify.
//
// Which address mail actually goes to is decided by progressEmailRecipient() in
// server/lib/contactEmail.js, not by these routes.
const { z } = require('zod');
const { defineRoute, errors } = require('./route');
const { AdultUser } = require('./schemas');

const BAD_EMAIL = 'Please enter a valid email address.';
const BAD_LINK = 'This confirmation link is invalid or has expired.';

const SetContactEmailRequest = z
  .object({
    email: z
      .string({ error: BAD_EMAIL })
      .trim()
      .toLowerCase()
      .max(254, { error: BAD_EMAIL })
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: BAD_EMAIL })
      .meta({ description: "Where progress emails should go. Not an Apple private relay address." }),
  })
  .meta({ id: 'SetContactEmailRequest' });

const ContactEmailResponse = z
  .object({
    user: AdultUser,
    verification_sent: z.boolean().meta({
      description: 'True when a confirmation link was just emailed to user.contact_email. False when the address '
        + 'was already verified, so nothing needed sending.',
    }),
  })
  .meta({ id: 'ContactEmailResponse' });

const VerifyEmailRequest = z
  .object({
    token: z
      .string({ error: BAD_LINK })
      .min(1, { error: BAD_LINK })
      .max(512, { error: BAD_LINK })
      .meta({ description: 'The token from a /parent/verify?token=… link.' }),
  })
  .meta({ id: 'VerifyEmailRequest' });

const VerifyEmailResponse = z
  .object({
    ok: z.boolean(),
    verified: z.string().meta({
      description: 'Which address the link proved: email (the login email) or contact_email.',
    }),
  })
  .meta({ id: 'VerifyEmailResponse' });

const routes = [
  defineRoute({
    method: 'put',
    path: '/api/auth/contact-email',
    operationId: 'setContactEmail',
    summary: "Set where the parent's progress emails go, and email a link to verify it. "
      + 'A new address is unverified until the link is used.',
    tags: ['auth'],
    auth: true,
    body: SetContactEmailRequest,
    responses: {
      200: { description: 'Saved. See verification_sent.', schema: ContactEmailResponse },
      ...errors(400, 401, 403, 404, 429, 502),
    },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/contact-email/resend',
    operationId: 'resendContactEmailVerification',
    summary: 'Email a fresh verification link to the unverified contact email.',
    tags: ['auth'],
    auth: true,
    responses: {
      200: { description: 'Sent, or already verified. See verification_sent.', schema: ContactEmailResponse },
      ...errors(401, 403, 404, 409, 429, 502),
    },
  }),
  defineRoute({
    method: 'post',
    path: '/api/auth/email/verify',
    operationId: 'verifyEmail',
    summary: 'Redeem a /parent/verify link, verifying the login or contact email it was sent for.',
    tags: ['auth'],
    body: VerifyEmailRequest,
    responses: {
      200: { description: 'Verified.', schema: VerifyEmailResponse },
      ...errors(400),
    },
  }),
];

module.exports = {
  routes,
  SetContactEmailRequest,
  ContactEmailResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
};
