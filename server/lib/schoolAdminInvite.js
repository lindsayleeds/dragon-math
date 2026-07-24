// Grant school-admin access by email and send a welcome email.
//
// Mirrors the teacher-add flow (server/routes/school.js): if no account owns the
// email yet, we mint a passwordless "login by URL" account so there's a unique
// /k/<token> link to hand out; if the account already exists we just layer the
// admin grant on and point them at their usual sign-in. Used by both the school
// dashboard (POST /api/school/:schoolId/admins) and the site-admin panel
// (POST /api/admin/schools/:schoolId/admins) so the two flows behave identically.

const crypto = require('crypto');
const { and, eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { sendEmail } = require('./email');

const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

// Every welcome email is blind-copied here so there's a record of who was
// invited. Override via env; defaults to the shared project inbox.
const WELCOME_EMAIL_BCC = process.env.WELCOME_EMAIL_BCC || 'mydragonmath@gmail.com';

// --- Brand tokens (the "dragon's keep" identity: parchment + emerald + gold) ---
const C = {
  parchment: '#FBF6E9',
  page: '#F1E8CF',
  pine: '#123D2A',
  meadow: '#2F8F5B',
  gold: '#E6A32E',
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

// Build the welcome email. `loginUrl` is the unique /k/<token> link for a freshly
// created account (null when the person already had one). `dashboardUrl` is where
// everyone lands after signing in.
function buildAdminInviteEmail({ schoolName, loginUrl, dashboardUrl, created }) {
  const safeSchool = escapeHtml(schoolName);
  const subject = created
    ? `You're a Dragon Math admin for ${schoolName} — here's your login link`
    : `You're now an admin for ${schoolName} on Dragon Math`;

  const ctaUrl = created ? loginUrl : dashboardUrl;
  const ctaLabel = created ? 'Open your dashboard →' : 'Go to your dashboard →';

  const linkNote = created
    ? `<p style="margin:0 0 6px;font-family:${BODY};font-size:14px;line-height:1.6;color:${C.barkSoft};">
         This link is unique to you — keep it private. You can also sign in with Google
         using this same email address; both open the same account.
       </p>
       <p style="margin:0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.barkSoft};word-break:break-all;">
         ${escapeHtml(loginUrl)}
       </p>`
    : `<p style="margin:0;font-family:${BODY};font-size:14px;line-height:1.6;color:${C.barkSoft};">
         Sign in with your usual password or with Google, then open the School dashboard.
       </p>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${C.parchment};border:1px solid ${C.cardEdge};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${C.pine};padding:22px 28px;">
          <span style="font-family:${DISPLAY};font-size:22px;font-weight:700;color:#ffffff;">🐉 Dragon Math</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-family:${DISPLAY};font-size:22px;line-height:1.3;color:${C.pine};">
            You're an admin for ${safeSchool}
          </h1>
          <p style="margin:0 0 18px;font-family:${BODY};font-size:15px;line-height:1.6;color:${C.bark};">
            You've been added as an administrator of <strong>${safeSchool}</strong> on Dragon Math.
            Admins can see every student, manage teachers, and add or remove other admins.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td style="background:${C.coral};border-bottom:3px solid ${C.coralEdge};border-radius:12px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;font-family:${DISPLAY};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${ctaLabel}</a>
            </td></tr>
          </table>
          ${linkNote}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid ${C.cardEdge};">
          <p style="margin:0;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.barkSoft};">
            If you weren't expecting this, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

// Grant admin + send the welcome email. Returns a plain result object the caller
// maps to an HTTP response; only unexpected DB errors throw. Email failures are
// non-fatal (the grant still stands) and surface as `email_sent: false`.
async function inviteSchoolAdmin({ schoolId, email }) {
  const [school] = await db
    .select({ id: schema.schools.id, name: schema.schools.name })
    .from(schema.schools)
    .where(eq(schema.schools.id, schoolId))
    .limit(1);
  if (!school) return { error: 'school_not_found' };

  const [existing] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      accountType: schema.users.accountType,
      loginToken: schema.users.loginToken,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let adult;
  let created = false;
  let loginToken = null;

  if (existing) {
    if (existing.accountType !== 'parent') return { error: 'account_conflict' };
    adult = existing;
    // Only surface a personal login link when this account signs in by URL
    // (has a token and no password); password/Google admins use their own.
    loginToken = !existing.passwordHash && existing.loginToken ? existing.loginToken : null;
    const inserted = await db
      .insert(schema.schoolAdmins)
      .values({ schoolId, userId: adult.id })
      .onConflictDoNothing()
      .returning({ userId: schema.schoolAdmins.userId });
    if (inserted.length === 0) return { error: 'already_admin' };
  } else {
    // No account yet — mint a URL-login admin. username = email mirrors the
    // parent-signup convention (kids can't type '@', so no namespace collision).
    loginToken = crypto.randomUUID();
    try {
      adult = await db.transaction(async (tx) => {
        const [ins] = await tx
          .insert(schema.users)
          .values({
            username: email,
            accountType: 'parent',
            email,
            loginToken,
            emailVerified: false,
          })
          .returning({ id: schema.users.id, email: schema.users.email, username: schema.users.username });
        await tx
          .insert(schema.schoolAdmins)
          .values({ schoolId, userId: ins.id })
          .onConflictDoNothing();
        return ins;
      });
      created = true;
    } catch (err) {
      if (err?.code === '23505') return { error: 'race_exists' };
      throw err;
    }
  }

  const loginPath = loginToken ? `/k/${loginToken}` : null;
  const loginUrl = loginPath ? `${APP_PUBLIC_URL}${loginPath}` : null;
  const dashboardUrl = `${APP_PUBLIC_URL}/school`;

  let emailSent = false;
  let emailError = null;
  try {
    const { subject, html } = buildAdminInviteEmail({
      schoolName: school.name,
      loginUrl,
      dashboardUrl,
      created,
    });
    await sendEmail({ to: email, subject, html, bcc: WELCOME_EMAIL_BCC });
    emailSent = true;
  } catch (err) {
    // A mail failure must not roll back a grant that already succeeded — the
    // admin can still copy the returned link by hand.
    emailError = err?.message || 'Failed to send welcome email';
    console.error('[schoolAdminInvite] email send failed for', email, '·', emailError);
  }

  return {
    admin: { id: adult.id, email: adult.email, username: adult.username },
    created,
    login_link: loginPath,
    email_sent: emailSent,
    email_error: emailError,
    bcc: emailSent ? WELCOME_EMAIL_BCC : null,
  };
}

module.exports = { inviteSchoolAdmin, buildAdminInviteEmail };
