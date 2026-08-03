// Transactional auth emails (password reset + email verification). The card
// itself now lives in ./emailShell, shared with the billing emails.

const { sendEmail } = require('./email');
const { renderShell } = require('./emailShell');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

// Send a password-reset link. `token` is the RAW token (only ever here + in DB
// as a hash). Caller decides whether an account exists — this just sends.
async function sendPasswordResetEmail(to, token) {
  const url = `${APP_PUBLIC_URL}/parent/reset?token=${encodeURIComponent(token)}`;
  const html = renderShell({
    heading: 'Reset your password',
    body: 'We got a request to reset the password for your My Dragon Math account. Tap the button below to choose a new one. This link expires in 1 hour.',
    buttonLabel: 'Choose a new password',
    url,
    footnote: "If you didn't ask to reset your password, you can safely ignore this email — nothing has changed.",
  });
  return sendEmail({ to, subject: 'Reset your My Dragon Math password', html });
}

// Send an email-verification link. `token` is the RAW token.
async function sendVerificationEmail(to, token) {
  const url = `${APP_PUBLIC_URL}/parent/verify?token=${encodeURIComponent(token)}`;
  const html = renderShell({
    heading: 'Confirm your email',
    body: "Welcome to My Dragon Math! Please confirm this is your email so we can send you your child's weekly progress and keep your account secure. This link expires in 24 hours.",
    buttonLabel: 'Confirm my email',
    url,
    footnote: "If you didn't create a My Dragon Math account, you can safely ignore this email.",
  });
  return sendEmail({ to, subject: 'Confirm your My Dragon Math email', html });
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };
