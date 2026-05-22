// Thin wrapper around Resend. If RESEND_API_KEY is missing, prints the
// rendered HTML to stdout instead of sending so the weekly digest pipeline
// is testable in dev without external services.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const DEFAULT_FROM = process.env.WEEKLY_REPORT_FROM || 'My Dragon Math <no-reply@dragonmath.local>';

let resendClient = null;
if (RESEND_API_KEY) {
  // eslint-disable-next-line global-require
  const { Resend } = require('resend');
  resendClient = new Resend(RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, from = DEFAULT_FROM }) {
  if (!resendClient) {
    console.log('[email:stub] →', to, '·', subject);
    console.log('[email:stub] (set RESEND_API_KEY to send for real)');
    console.log(html);
    return { stubbed: true };
  }
  const result = await resendClient.emails.send({ from, to, subject, html });
  if (result.error) throw new Error(result.error.message || 'Resend send failed');
  return { id: result.data?.id };
}

module.exports = { sendEmail };
