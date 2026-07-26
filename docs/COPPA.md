# COPPA: Unparented Child Accounts (Guest Mode — Abandoned)

## Context

Every kid who plays Dragon Math gets a server-side row in the `users` table the moment they type a handle into the sign-in form. That row accumulates server-side history: `node_progress`, `problem_attempts`, `wrong_taps`, `matches`, `play_minutes`, `user_companions`, `dragon_trial_results`. Most of these kids have **no parent linked** to their account, meaning we're storing data about a child without any verifiable parental consent — exactly what COPPA wants us to avoid.

This problem is real and unresolved; the rest of this document records a rejected solution so it isn't re-proposed as new.

## Rejected solution: guest mode

A **guest mode** for unparented kids was designed and then abandoned:

- **Guest = no server presence at all.** Handle and progress would live entirely in `localStorage` on the device; the server would never see the kid.
- **Linked = server-side, parental-consent-first.** A child row in `users` would only be created when a parent explicitly issues an invite code; the kid claims it on their device, and that act creates the row.
- **Upgrade path:** when a guest claims an invite code, the guest's local progress would be uploaded once to seed the new linked account, then cleared from the device.

It was never implemented: `parent_claim_codes` (the child-issued claim-code path it would have replaced) is still in [server/db/schema.js](server/db/schema.js), [server/routes/childCode.js](server/routes/childCode.js) still exists, and no invite/claim/import endpoints were built.
