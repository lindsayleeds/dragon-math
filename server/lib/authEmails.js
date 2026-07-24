// Transactional auth emails (password reset + email verification), rendered in
// the same "dragon's keep" identity as the weekly digest. Kept deliberately
// simple: a single-column parchment card with one action button and a plain-text
// fallback link. The send helpers wrap sendEmail() and build the tokenized URL.

const { sendEmail } = require('./email');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

const C = {
  parchment: '#FBF6E9',
  page: '#F1E8CF',
  pine: '#123D2A',
  coral: '#EE6C4D',
  coralEdge: '#C9553C',
  bark: '#4A4038',
  barkSoft: '#7C7266',
  cardEdge: '#EBDFC2',
};
const DISPLAY = "'Trebuchet MS','Segoe UI',Tahoma,Geneva,sans-serif";
const BODY = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// One branded card: dragon crest, a heading, a line of body copy, a big action
// button, and the raw link as a fallback (some mail clients strip buttons).
function renderShell({ heading, body, buttonLabel, url, footnote }) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${C.parchment};border:1px solid ${C.cardEdge};border-radius:18px;overflow:hidden;">
        <tr><td style="background:${C.pine};padding:22px 28px;text-align:center;">
          <span style="font-family:${DISPLAY};font-size:22px;font-weight:700;color:#ffffff;">🐉 My Dragon Math</span>
        </td></tr>
        <tr><td style="padding:30px 30px 8px;">
          <h1 style="margin:0 0 12px;font-family:${DISPLAY};font-size:22px;color:${C.pine};">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 22px;font-family:${BODY};font-size:15px;line-height:1.5;color:${C.bark};">${body}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
            <tr><td style="border-radius:12px;background:${C.coral};border-bottom:3px solid ${C.coralEdge};">
              <a href="${safeUrl}" style="display:inline-block;padding:13px 30px;font-family:${DISPLAY};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(buttonLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-family:${BODY};font-size:12px;color:${C.barkSoft};">Or paste this link into your browser:</p>
          <p style="margin:0 0 22px;font-family:${BODY};font-size:12px;word-break:break-all;"><a href="${safeUrl}" style="color:${C.coralEdge};">${safeUrl}</a></p>
          <p style="margin:0;font-family:${BODY};font-size:12px;line-height:1.5;color:${C.barkSoft};">${footnote}</p>
        </td></tr>
        <tr><td style="padding:18px 30px 26px;text-align:center;">
          <span style="font-family:${BODY};font-size:11px;color:${C.barkSoft};">My Dragon Math · a cozy place to grow math confidence</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

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
