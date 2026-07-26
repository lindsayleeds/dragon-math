// Thin wrapper around Resend. With no RESEND_API_KEY, sending fails loudly by
// default so a missing key can never silently swallow mail in a real
// deployment. Set EMAIL_STUB=1 to opt into printing the rendered HTML to stdout
// instead (local dev without external services). This is deliberately decoupled
// from NODE_ENV so the safety net stays armed regardless of how the process is
// launched.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const DEFAULT_FROM = process.env.WEEKLY_REPORT_FROM || 'My Dragon Math <no-reply@dragonmath.local>';
const EMAIL_STUB = process.env.EMAIL_STUB === '1';

let resendClient = null;
if (RESEND_API_KEY) {
  // Required lazily so a deployment with no key never has to install `resend`.
  const { Resend } = require('resend');
  resendClient = new Resend(RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, from = DEFAULT_FROM, bcc }) {
  if (!resendClient) {
    // No key configured. Only pretend-to-send when explicitly opted in; anything
    // else fails loudly so a dropped key in prod surfaces immediately.
    if (!EMAIL_STUB) {
      throw new Error('RESEND_API_KEY is not configured; set it to send email, or set EMAIL_STUB=1 to log instead');
    }
    console.log('[email:stub] →', to, bcc ? `(bcc ${bcc})` : '', '·', subject);
    console.log('[email:stub] (set RESEND_API_KEY to send for real)');
    console.log(html);
    return { stubbed: true };
  }
  const payload = { from, to, subject, html };
  if (bcc) payload.bcc = bcc;
  const result = await resendClient.emails.send(payload);
  if (result.error) throw new Error(result.error.message || 'Resend send failed');
  return { id: result.data?.id };
}

// Snapshot of how email is configured, for a loud boot-time log so a missing
// key is obvious immediately — not only when the first send fails.
//   live     → a real key is set; mail is delivered.
//   stub     → no key, EMAIL_STUB=1; mail is logged to stdout, NOT delivered.
//   disabled → no key, no stub opt-in; every send() will throw.
function emailConfigStatus() {
  if (resendClient) return { ok: true, mode: 'live' };
  if (EMAIL_STUB) return { ok: true, mode: 'stub' };
  return { ok: false, mode: 'disabled' };
}

module.exports = { sendEmail, emailConfigStatus };
