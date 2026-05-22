# Dragon Math — Open Work

Tracks what's left across the parent-accounts feature and shipping to
`mydragonmath.com`. Tick items as they land.

## Deployment / env vars (blocks shipping)

- [x] **Set `JWT_SECRET`** to a real secret in production. Loaded via
      `dotenv` from `/home/azureuser/repos/dragon-math/.env` (chmod 600,
      gitignored). Production tokens now verify against the real secret only.
- [x] **Set `APP_PUBLIC_URL=https://mydragonmath.com`** so the "Open the
      dashboard" button in the weekly digest points at production —
      [server/lib/weeklyReport.js:5](server/lib/weeklyReport.js#L5).
- [x] **Set `ENABLE_CRON=1`** (or run with `NODE_ENV=production`) so the
      Monday-morning weekly digest cron actually fires —
      [server/cron.js:6](server/cron.js#L6). Set in `.env`; pm2
      `dragonmath-api` restarted with `--update-env` and now logs
      `🗓 Weekly digest cron scheduled` at boot.
- [x] **API serving.** nginx on the Azure VM serves `dist/` statically and
      proxies `/api/` → `127.0.0.1:4070` (same origin, so CORS isn't needed in
      prod) — `/etc/nginx/sites-enabled/mydragonmath.com`.
- [x] **TLS + HTTPS termination.** certbot-managed Let's Encrypt cert on
      nginx for `mydragonmath.com` + `www.mydragonmath.com`.
- [x] **Process supervisor.** Running under PM2 as `dragonmath-api`
      (fork mode, script `server/index.js`).
- [x] **Investigate `dragonmath-api` crash-loop history.** The 48,646 restart
      count was lifetime accumulation; the loop had already self-resolved
      ~57 min before being noticed (current pid stable, `exit_code: 0`,
      `unstable_restarts: 0`, error log empty across 48k+ restarts). Root
      cause couldn't be confirmed from forensics since pm2 captured no stderr
      or shutdown messages — likely a now-overwritten working-tree state.
      PM2 counters reset via `pm2 reset dragonmath-api`. If it recurs, the
      first thing to add is request logging / a `process.on('exit', ...)`
      hook so we can see WHY the process is leaving with code 0.
- [ ] **Backups** for `dragon-math.db`. Today it's a single SQLite file at
      the repo root; nothing else has a copy of parent emails or password
      hashes.

## Google OAuth

- [ ] Create an OAuth 2.0 Client ID in Google Cloud Console.
- [ ] Add **Authorized JavaScript origins**: `https://mydragonmath.com`,
      `http://localhost:5173`.
- [ ] Set `GOOGLE_OAUTH_CLIENT_ID` (server) and `VITE_GOOGLE_OAUTH_CLIENT_ID`
      (built into the frontend bundle). Until both are set the "Sign in with
      Google" button stays disabled with a hint —
      [src/components/auth/GoogleSignInButton.jsx](src/components/auth/GoogleSignInButton.jsx).

## Resend / email

- [ ] Verify `mydragonmath.com` as a sending domain in Resend (SPF, DKIM,
      DMARC DNS records).
- [ ] Set `RESEND_API_KEY` and `WEEKLY_REPORT_FROM` (e.g.
      `"Dragon Math <reports@mydragonmath.com>"`). Until then sends are stubbed
      to stdout — [server/lib/email.js](server/lib/email.js).
- [ ] Manually run the digest once (`node -e "require('./server/lib/weeklyReport').runWeeklyReports(new Date())"`)
      against a real inbox to confirm rendering before flipping the cron on.

## Parent-account follow-ups

These aren't blocking launch but will come up quickly once real parents arrive.

- [ ] **Password reset flow.** No way to recover a forgotten parent password
      today. Wire a `POST /api/auth/parent/forgot` that emails a one-use token,
      plus a `/parent/reset?token=…` page.
- [ ] **Email verification.** The `email_verified` column exists and gets set
      from the Google `email_verified` claim, but password signups never
      verify. Send a confirmation email and gate weekly digests on it.
- [ ] **Edit profile / change password / delete account.** Parents currently
      can't change their email or password or close their account.
- [ ] **"Send me a preview" button** on `/parent` so a parent can trigger the
      weekly digest on demand without waiting for Monday. Useful for QA too.
- [ ] **Fix the digest window.** [server/lib/weeklyReport.js](server/lib/weeklyReport.js)
      computes the prior Mon–Sun window correctly but then asks
      `buildAnalytics(..., { days: 7 })`, which is "last 7 days from now," not
      that exact window. Push a date range into `buildAnalytics` so the digest
      lines up with the dates printed in the email.
- [ ] **Extract `ChildAnalytics` shared component.** Plan called for lifting
      the admin analytics rendering out of
      [src/pages/AdminPage.jsx](src/pages/AdminPage.jsx) so the parent stats
      page and admin tab share UI. We shipped a leaner standalone parent stats
      page; consolidating later avoids drift.
- [ ] **Multi-parent support sanity check.** The schema supports it
      (`parent_child_links` is many-to-many) but the UX assumes one grown-up.
      Decide whether a second parent should see the same stats or have any
      restriction.

## Nice-to-haves (no rush)

- [ ] **Rate limiter is in-memory.** Fine for one process; revisit if we ever
      scale horizontally — [server/lib/rateLimit.js](server/lib/rateLimit.js).
- [ ] **Admin area still uses a shared password.** Not blocking parents, but
      consider promoting `admin` into a real `account_type` so the
      teacher/dev tools live behind a real user instead of a shared secret —
      [server/middleware/admin.js](server/middleware/admin.js).
- [ ] **Tests.** No automated coverage on the new auth or parent routes.
      A small Playwright suite covering signup → link → stats would catch
      regressions.
- [ ] **Privacy + COPPA copy.** If `mydragonmath.com` is going public to under-13
      kids, add a privacy policy and parental-consent language somewhere
      visible from the kid signin and the parent signup.
- [ ] **Copy voice pass on the profile modal.** Labels like "Save", "Choose
      your avatar", and "My Companions" are functional but read SaaS-y. Brand
      voice would suggest something like "Stash it", "Pick your hero", "Field
      companions" — see the voice section of [BRAND.md](BRAND.md#L17). Styling
      is already on-brand; this is the language pass that was skipped —
      [src/components/profile/ProfileModal.jsx](src/components/profile/ProfileModal.jsx).
- [ ] **Review `/api/auth/signin` auto-create behavior.** Posting any unknown
      username/password to `POST /api/auth/signin` silently creates a new
      child account and returns a token. This is by design for the kid
      flow (no signup friction), but it means typos create orphan accounts
      and the endpoint can be used to enumerate / spam the users table.
      Decide whether to (a) keep as-is, (b) require an explicit
      `/api/auth/signup` for new kids, or (c) at least rate-limit and clean
      up the stray `__nope__` row left over from the JWT_SECRET smoke test —
      [server/routes/auth.js](server/routes/auth.js).
