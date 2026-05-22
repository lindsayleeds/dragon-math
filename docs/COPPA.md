# Guest-Mode Kids (COPPA Minimization)

## Context

Today, every kid who plays Dragon Math gets a server-side row in the `users` table the moment they type a handle into the sign-in form. That row accumulates server-side history: `node_progress`, `problem_attempts`, `wrong_taps`, `matches`, `play_minutes`, `user_companions`, `dragon_trial_results`. Most of these kids have **no parent linked** to their account, meaning we're storing data about a child without any verifiable parental consent — exactly what COPPA wants us to avoid.

This change introduces a **guest mode** for unparented kids:

- **Guest = no server presence at all.** Handle and progress live entirely in `localStorage` on the device. The server never sees the kid.
- **Linked = server-side, parental-consent-first.** A child row in `users` is only created when a parent explicitly issues an invite code; the kid claims it on their device, and that act creates the row.
- **Upgrade path:** when a guest claims an invite code, the guest's local progress is uploaded once to seed the new linked account, then cleared from the device.

This gives us the strongest COPPA story: under-13s have zero server footprint unless a parent has consented by issuing an invite. It also lets us delete the existing test-account population (per user: "they are all test accounts") instead of migrating it.

Recommendation chosen with the user:
- **Server storage for guests:** zero. Pure on-device localStorage. ([1])
- **Existing unparented children:** deleted outright (test data).
- **Linking direction:** parent generates the invite code, kid enters it on their device. ([2])
- **Linked-kid signin on new devices:** invite-code only — no more "type your username to resume on any device." ([3])

## Critical files

### Server
- [server/db.js](server/db.js) — schema. Add a `parent_invite_codes` table (parent-issued, not yet bound to a child). Drop the existing `parent_claim_codes` (child-issued) path. Bump schema version, write a one-shot migration that deletes every `users` row where `account_type = 'child' AND id NOT IN (SELECT child_id FROM parent_child_links)` plus all cascade rows.
- [server/routes/auth.js](server/routes/auth.js) — remove `POST /api/auth/signin`'s auto-create-on-username branch (lines 51–69). Replace with `POST /api/auth/claim-invite { code, handle, avatar }` that validates the parent-issued invite, creates the `users` row with `account_type='child'`, inserts the `parent_child_links` row, deletes the invite code, returns JWT + safeUser. Kid signin by raw username goes away entirely.
- [server/routes/parent.js](server/routes/parent.js) — replace `POST /api/parent/children/link` (the kid-generates-code flow, lines 63–95) with `POST /api/parent/children/invite { handle?, avatar? }` that generates a 6-digit code (15-min TTL) scoped to this parent and returns it. Handle and avatar are optional — if the parent prefills them, the invite is pre-bound; otherwise the kid picks on their device. Reuse the existing rate-limit pattern at line 64–66.
- [server/routes/childCode.js](server/routes/childCode.js) — delete; the child-side claim-code endpoint is obsolete.
- New endpoint: `POST /api/progress/import` in [server/routes/progress.js](server/routes/progress.js) — accepts a JSON blob `{ current_node_id, progress[], dragon_trial?, companions[], active_companion_id }`. Strictly one-shot: refuses if the user already has any `node_progress` rows. Reuses the same validation as `PUT /api/progress/:nodeId` (the `NODE_LAYOUT` lookup, the stars range check). Inside a single `db.transaction`, writes `node_progress` rows, advances `current_node_id`, sets `dragon_trial_completed` + writes `dragon_trial_results` if present, inserts `user_companions` rows, sets `active_companion_id`. Per-problem analytics (`problem_attempts`, `wrong_taps`, `matches`, `play_minutes`) are **not** imported — that history was generated pre-consent and shouldn't survive the upgrade.
- [server/routes/dragonTrial.js](server/routes/dragonTrial.js), [server/routes/attempts.js](server/routes/attempts.js), [server/routes/matches.js](server/routes/matches.js), [server/routes/playtime.js](server/routes/playtime.js), [server/routes/companions.js](server/routes/companions.js) — no code changes; they already require auth so guests (who have no JWT) simply never call them.

### Client
- [src/api.js](src/api.js) — add `guestStorage` helpers next to the existing `getToken/setToken` (lines 3–12): `getGuestState()`, `setGuestState(partial)`, `clearGuest()`. Keys: `dm_guest_handle`, `dm_guest_avatar`, `dm_guest_progress` (JSON blob).
- [src/contexts/AuthContext.jsx](src/contexts/AuthContext.jsx) — add a third state branch alongside `user`. On mount: if `dm_token` exists → existing `GET /api/auth/me` path; else if `dm_guest_handle` exists → synthesize a guest user object `{ account_type: 'guest', username, avatar, current_node_id, dragon_trial_completed }` from localStorage; else → null. Expose `isGuest` derived flag. Add `startGuest(handle, avatar)` and `claimInvite(code)` helpers; on claim success, call the import endpoint with the guest blob, then `clearGuest()` and `handleAuthSuccess(token, user)`.
- [src/components/auth/SignInForm.jsx](src/components/auth/SignInForm.jsx) — rewrite as the kid entry screen with two paths: **"Start playing"** (handle + avatar → guest mode, no network call) and **"I have a code from a grown-up"** (code + handle + avatar → claim flow). Reuse the existing `USERNAME_RE` shape (2–24, alphanumeric + `-_`) client-side only — server validation only runs on the claim path now.
- [src/hooks/useNodeProgress.js](src/hooks/useNodeProgress.js) — branch on `isGuest`. Guest path: read/write `dm_guest_progress` in localStorage; no network. Server path: unchanged.
- [src/hooks/useBattle.js](src/hooks/useBattle.js) — wrap `POST /api/matches`, `POST /api/matches/:id/end`, `POST /api/attempts` calls in `if (!isGuest)`. Guest gameplay is identical client-side but emits no server analytics.
- [src/contexts/CompanionContext.jsx](src/contexts/CompanionContext.jsx) — same pattern: branch on `isGuest`, store companion unlocks in `dm_guest_progress` for guests.
- [src/pages/DragonTrialPage.jsx](src/pages/DragonTrialPage.jsx) (around line 66–81) — branch on `isGuest`: server path posts to `/api/dragon-trial/complete` (unchanged); guest path writes `dragon_trial_completed`, `dragon_trial_result`, and the promoted `current_node_id` directly into `dm_guest_progress`, then updates the in-memory user via `updateUser`.
- [src/pages/MapPagePaper.jsx](src/pages/MapPagePaper.jsx) — no code change expected (it reads from `useNodeProgress` / `useAuthContext`, which already abstract the source).
- [src/pages/ParentDashboardPage.jsx](src/pages/ParentDashboardPage.jsx) — rewrite the `AddChildModal` (lines 150–214). Old UX: "ask your kid to read you their code." New UX: parent clicks "Add a kid" → optionally types a handle/avatar → server returns a 6-digit code with countdown → parent reads it to the kid. Show the invite codes as ephemeral; don't list "pending invites" — let them expire.
- [src/pages/ParentChildStatsPage.jsx](src/pages/ParentChildStatsPage.jsx) — no change. Stats only show for linked kids, which is already true.
- [src/pages/AdminPage.jsx](src/pages/AdminPage.jsx) — the children table (lines 276–396) will naturally show only linked kids post-migration; tighten the underlying query in [server/routes/admin.js](server/routes/admin.js) `GET /api/admin/accounts` (lines 127–155) to `INNER JOIN parent_child_links` so unparented kids can never appear even if some sneak in.
- Delete [src/pages/ParentSetupPage.jsx](src/pages/ParentSetupPage.jsx) if it still drives the kid-generates-code UI, or update it to invite-code-only.

## Data migration (one-shot, runs on next server start)

Inside [server/db.js](server/db.js) bootstrap, after schema bump:

```sql
-- Cascades handle node_progress, problem_attempts, wrong_taps, matches,
-- play_minutes, user_companions, dragon_trial_results.
DELETE FROM users
 WHERE account_type = 'child'
   AND id NOT IN (SELECT child_id FROM parent_child_links);
DROP TABLE IF EXISTS parent_claim_codes;
```

No backup table — user confirmed all unparented kids are test accounts.

## Verification

End-to-end, run locally:

1. **Fresh guest play.** Open the app in a private window. Pick a handle → land on map → win a node → reload. Progress survives reload. Open DevTools → Application → Local Storage: confirm `dm_guest_progress` is present, **no `dm_token`**, **no calls to `/api/progress`, `/api/attempts`, `/api/matches`, `/api/playtime/heartbeat`** in the Network tab during the battle.
2. **Trial as guest.** Same window, take the Dragon's Trial → finish → confirm placement promotion lives in `dm_guest_progress`, no `POST /api/dragon-trial/complete` fired.
3. **Server is empty for guests.** `sqlite3 server/data.db "SELECT id, username, account_type FROM users;"` should show only the parent + previously-linked kids. The guest does not appear.
4. **Parent-issued invite flow.** Sign in as a parent → click "Add a kid" → copy the 6-digit code. In the kid's private window (still in guest mode with progress), click "I have a code" → enter code + handle + avatar → confirm: (a) `dm_guest_*` keys are cleared, (b) `dm_token` is set, (c) the linked kid lands on the same node they were on as a guest, (d) `sqlite3 ... "SELECT * FROM node_progress WHERE user_id = …;"` shows the imported rows, (e) parent dashboard now lists this kid with the right `current_node_id`.
5. **Linked kid on a fresh device.** Sign out → open another private window → try to "Start playing" with the same handle → confirm you get a fresh guest, **not** the linked account. Then have the parent issue a new invite code, claim it → confirm the linked account loads with full server progress (not imported again — the import endpoint refuses because `node_progress` rows already exist).
6. **Expired / wrong invite codes.** Try claiming an expired code, a wrong code, and a code from a different parent → all return the same generic 400, no enumeration possible.
7. **Migration sanity.** Before the schema bump runs, `SELECT COUNT(*) FROM users WHERE account_type='child'` and the same query after — confirm only previously-linked kids survive.
8. **Admin page.** Open `/admin` → confirm the children table only contains parent-linked kids.

Playwright coverage worth adding: the guest → claim → import upgrade flow (steps 1, 4, 5 above) as a single test, since it's the highest-risk path in this change.

## Notes for implementation

- **Reuse the existing rate-limit at [server/routes/parent.js:64–66](server/routes/parent.js#L64-L66)** for the new invite-issuance endpoint and the new claim endpoint — the existing pattern already keys by `req.user.id:ip` and is the right shape.
- **Reuse [server/db.js](server/db.js)'s `db.transaction` pattern** for the import endpoint — see how [server/routes/dragonTrial.js:82–128](server/routes/dragonTrial.js#L82-L128) wraps multi-table writes; mirror that.
- **Don't invent a guest UUID.** There's no value in giving guests a synthetic ID — nothing on the server references it, and inventing one risks accidentally treating it as a real user ID elsewhere.
- **`dragon_trial_completed` for guests** lives in `dm_guest_progress` and is read into the synthesized user object by AuthContext. The existing `user.dragon_trial_completed` check at [src/pages/MapPagePaper.jsx](src/pages/MapPagePaper.jsx) (around line 295, per the explore) continues to work unchanged.
- **Avatar list** ([server/routes/auth.js:18–24](server/routes/auth.js#L18-L24)) stays server-side as the canonical list, but the client should also know it so guests (who never call `GET /api/auth/avatars`) can show the picker offline. Consider extracting `ALLOWED_AVATARS` into a shared module that both sides import.

[1]: Q&A — chose "Need recommendation"; recommendation = zero server storage.
[2]: Q&A — chose "Parent generates code, kid enters."
[3]: Q&A — chose "Invite-code-only on new devices."
