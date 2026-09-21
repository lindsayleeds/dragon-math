# Admin accounts

From the signed-out landing page, admins choose **Admin sign in**, then use their
own password or Google account and land on `/admin`. A non-admin account entered
through that form is signed back out and refused access. Signed-in admins see an
**Open admin** entry point on the landing page. Multiple users can have
`account_type = 'admin'`.
Public signup always creates a parent; an email address alone never grants admin.
Admin is a separate account type, not a bypass for parent, teacher, or school
ownership checks. Promoting a parent moves their landing page to the admin tools;
their existing child links and adult role remain stored for a later demotion.

## Phonics audio review

The **Phonics audit** tab lists each distinct target or cue word once while
retaining its level, missing-pattern, expected-answer, and cue contexts. Play a
row before reviewing it: the source label reports whether the game actually
completed the committed recording or fell back to the current device voice.
Mark recordings as sounding right or flagged, filter the list, and export JSON
when the pass is complete. Review choices are local to that browser; if browser
storage is unavailable, they survive only for the current page session and the
panel displays a warning.

## What a promotion pauses

`account_type` is the single column every adult guard reads, so while an account
is an admin it is not a parent to `requireParent`: the parent and teacher
dashboards, the Stripe billing portal, parent API keys, and the weekly digest all
stop for that account until `--action revoke` restores it. Nothing is deleted —
child links, adult role, plan, and comp state are untouched — and the admin panel
lists admins in the adult roster with an `admin` badge, so their plan and comp
stay manageable from `/admin`. Grant admin to an account whose parent surface you
do not need day to day.

The household's shared-device link (`/k/<family token>`) is deliberately **not**
cleared on a role change and keeps resolving for an admin owner, because it mints
a child session for an already-linked child and never an adult one. Only the
adult's own permanent `/k/` login link and outstanding reset/verification tokens
are invalidated.

`/reset` is admin-only and now takes an explicitly selected child; it no longer
wipes the signed-in account's own progress. There is no self-service reset for a
child or parent.

## Initial rollout

The first admin is `lindsayleeds@gmail.com`. Sign up and verify this account first
if it does not already exist. Deploy the account-based admin release to the
environment before granting — see [../deploy/gcp/README.md](../deploy/gcp/README.md)
— so the live login keeps working while the old password-gated build is still
serving. Then run:

```sh
umask 077
printf 'DATABASE_URL=%s\n' \
  "$(gcloud secrets versions access latest --secret=dragon-math-prod-database-url \
       --project honorable-502113)" > /tmp/dm.env

DM_I_MEAN_PRODUCTION=1 bash deploy/admin-account.sh -e prod --env-file /tmp/dm.env \
  --email lindsayleeds@gmail.com --action grant

shred -u /tmp/dm.env
```

Use `-e test` for the test environment. The command validates the database
project, requires an existing verified adult with password or Google sign-in,
and removes the adult's own permanent login link plus outstanding
reset/verification tokens on role changes. Sign out and sign in again after
promotion; existing parent JWTs cannot authorize admin requests. No schema
push is needed: `account_type` is text.

The grant is a database change, not a deploy, so Cloud Run has no step in it.
The script runs locally from a repo checkout and connects straight to the
environment's Supabase database, so it needs `npm ci` to have been run and a
`--env-file` holding that database's `DATABASE_URL`. It fails closed rather than
editing the wrong database — the connection's user must be
`postgres.<DM_EXPECTED_DB_REF>` for the environment named by `-e`. If a grant is
refused, check that `DM_EXPECTED_DB_REF` in
[../deploy/environments/](../deploy/environments/) is still the Supabase project
the Cloud Run service is bound to; the fix is that file, never a hand-typed
`DATABASE_URL`.

## Additional admins and revocation

Run the same command with another verified adult's email to grant access. Use
`--action revoke` to return an admin to a parent account. The last admin cannot be
revoked until another has been granted. Commands are idempotent.

Every admin API request verifies the JWT and re-reads the user's current role.
Demotion or deletion therefore blocks existing admin sessions immediately.
Permanent `/k/` login links and parent API keys cannot authorize admin access.
Admin requests emit structured `admin_request` entries in the API process logs
with actor ID, method, path, and response status. Bodies, secrets, and query strings
are omitted. Retention follows the existing process-log retention policy.

`ADMIN_PASSWORD` is no longer read and can be removed from environment files.
Health checks remain public. School and child ownership middleware is unchanged.
