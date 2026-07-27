# COPPA: Unparented Child Accounts

## Context

No kid can sign themselves up. Every `accountType: 'child'` insert sits behind an
authenticated adult: a parent ([server/routes/parent.js](../server/routes/parent.js),
which writes the `parent_child_links` row in the same transaction), a teacher
([server/routes/classroom.js](../server/routes/classroom.js), behind `teacherOnly` +
`requireOwnsClassroom`), or a school-admin bulk import
([server/routes/school.js](../server/routes/school.js)). Kids then sign in with the
pre-issued login token in their `/k/<token>` link (`POST /api/auth/child-login`), and
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
