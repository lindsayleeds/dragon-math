# COPPA: Unparented Child Accounts

## Context

No kid can sign themselves up. Every `accountType: 'child'` insert sits behind an
authenticated adult: a parent ([server/routes/parent.js](../server/routes/parent.js),
which writes the `parent_child_links` row in the same transaction), a teacher
([server/routes/classroom.js](../server/routes/classroom.js), behind `teacherOnly` +
`requireOwnsClassroom`), or a school-admin bulk import
([server/routes/school.js](../server/routes/school.js)). Kids then sign in either with
the pre-issued token in their individual `/k/<token>` link
(`POST /api/auth/child-login`) or, for parent-linked children, by choosing their
handle or avatar from that parent's `/family/<token>` link
(`POST /api/auth/family-login`). The family picker does not return real/legal names.
`POST /api/auth/child/handle` is `requireAuth` and only renames a row an adult already
created.

So the consent gap is narrower than "a row appears the moment a kid types a handle":
parent-created children are consent-linked by construction. What is still exposed is
**teacher- and school-created** students. Those rows accumulate server-side history —
`node_progress`, `problem_attempts`, `wrong_taps`, `matches`, `play_minutes`,
`user_companions`, `dragon_trial_results` — with no `parent_child_links` row, so we hold
data about a child on school authority alone. COPPA does let a school consent on the
parent's behalf for school-directed educational use, so the open question is whether our
notice and DPA posture actually supports leaning on that, not whether the data is
collected with no consent at all.

That question is real and unresolved. The rest of this document records what guest mode
does and does not cover, so the rejected half isn't re-proposed as new.

## What ships: ephemeral guest mode

A guest plays with **no account and no server row at all**. `setGuestMode` in
[src/api.js](../src/api.js) routes auth-required endpoints to local stubs in
[src/data/guestStubs.js](../src/data/guestStubs.js), `enterGuest` in
[src/contexts/AuthContext.jsx](../src/contexts/AuthContext.jsx) mints an in-memory
`account_type: 'guest'` user, and [src/components/GuestBanner.jsx](../src/components/GuestBanner.jsx)
surfaces the state. Nothing is persisted — not server-side, not in `localStorage` — so a
page refresh ends the guest session.

## Rejected: persisted guest mode with an invite-code upgrade

A larger version of guest mode was designed and abandoned. It was never built, and it
should not come back as a new proposal:

- **Persisted local progress.** Handle and progress would live in `localStorage` across
  refreshes, rather than in the in-memory session that shipped.
- **Parent-issued invite code.** A child row in `users` would be created only when a
  parent explicitly issues an invite code and the kid claims it on their device.
- **One-time import.** Claiming the code would upload the guest's local progress once to
  seed the new linked account, then clear it from the device.

None of that exists: `parent_claim_codes` (the child-issued claim-code path it would have
replaced) is still in [server/db/schema.js](../server/db/schema.js),
[server/routes/childCode.js](../server/routes/childCode.js) still exists, and no
invite/claim/import endpoints were built.

## Account deletion

Parents can delete their account and their children's data from inside the iOS
app, as App Store Review Guideline 5.1.1(v) requires, via
`POST /api/account/delete` ([server/routes/account.js](../server/routes/account.js)).
The rules live in [server/lib/accountDeletion.js](../server/lib/accountDeletion.js):

- **The parent** is deleted, and with them (by ON DELETE CASCADE) their links to
  children, API keys, one-time email tokens, weekly-report log, the family login
  link, and any classrooms, tribes and school memberships they own.
- **A child with no other parent** is deleted at once, with all their data. The
  child-data tables that don't cascade (`node_progress`, `problem_attempts`,
  `wrong_taps`, `user_companions`, `play_minutes`, `matches`) are cleared first,
  and another kid's PvP match that names them as its opponent keeps the match
  but drops the name. This holds even when a teacher also has the child in a
  classroom: the parent asked for their child's data to be deleted.
- **A child who is also linked to another parent** (a co-parent) is kept and only
  unlinked. Their data belongs to the other parent's family too. When both
  parents delete at the same moment, row locks make sure the child isn't left
  with nobody: the second deletion sees the first one's link gone and deletes
  the child.
- **Kept, anonymized** (the user id goes to NULL): `billing_events`,
  `app_store_subscriptions`, comp-invite redemptions, and the `created_by` /
  `submitted_by` of anything the parent wrote for a co-parented child.
  App Store subscriptions aren't cancelled; Apple owns them and the parent
  manages them in Settings. The deletion does not cancel a Stripe subscription
  either (no billing helper for that yet); see the PR for #122.

The confirmation is a fresh Sign in with Apple: the token must carry the
signed-in parent's `apple_sub`. The same credential's authorization code lets
the server revoke the app's Apple grant ([server/lib/appleRevoke.js](../server/lib/appleRevoke.js),
configured by `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`; skipped
with a warning when unset).

This differs from the web's `DELETE /api/auth/account`, which asks for the
password and puts a child left with no parent into a 30-day grace period
(`orphanedAt`, [server/lib/orphanCleanup.js](../server/lib/orphanCleanup.js))
before deleting them. The app's deletion is immediate, so a child's login link
stops working with it.
