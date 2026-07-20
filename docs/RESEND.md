# Resend (transactional email)

Resend delivers the weekly parent digest. See [server/lib/email.js](../server/lib/email.js)
and [server/lib/weeklyReport.js](../server/lib/weeklyReport.js).

## Account

- **Signed up with:** `mydragonmath@gmail.com`
- Dashboard: https://resend.com
  - Domains: https://resend.com/domains
  - API keys: https://resend.com/api-keys

## Setup

1. Add `mydragonmath.com` as a domain in Resend and add the DNS records it
   provides (SPF/DKIM) at the domain's DNS host; wait for it to verify.
2. Create an API key.
3. In the production `.env`:
   ```
   RESEND_API_KEY=re_xxxxxxxx
   WEEKLY_REPORT_FROM=My Dragon Math <no-reply@mydragonmath.com>
   ```
4. `pm2 reload dragonmath-api` so dotenv picks up the new vars.

## Behavior

- No `RESEND_API_KEY` in dev: `sendEmail()` prints the HTML to stdout and the
  digest logs `status: 'stubbed'` (no email sent).
- No `RESEND_API_KEY` in production (`NODE_ENV=production`): hard failure, so
  nothing is silently dropped.
- `WEEKLY_REPORT_FROM` must use the Resend-verified domain; the
  `no-reply@dragonmath.local` default is a placeholder Resend rejects.
