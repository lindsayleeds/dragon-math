# Content API keys — session record and open work

Record of the session that built the parent API-key feature (2026-09-13), what
was verified, how far the deploy got, and what is left. Written because the
deploy stopped half-finished on an unrelated infrastructure failure.

**Status: LIVE ON PRODUCTION (code + schema), 2026-09-13. Test remains down for
an unrelated reason.**

**Update 2026-09-13 (second session):** production was deployed and pushed on
the owner's go-ahead, *out of the original test-first order* — test could not be
revived (see §5A) and waiting on it would have blocked the feature
indefinitely. The change is additive-only and CI was green, so the risk of
skipping test was judged small and taken deliberately. Production is now serving
`52b1150` with `api_keys` created; §5C records what ran. The only thing left on
production is a smoke test with a real key (§5D), which needs a parent login.

---

## 1. What was asked, and what was already there

The ask: a way to add/edit/remove **spelling lists** and **memory passages**
from an API rather than by clicking through the parent dashboard.

First finding: **memory passages already existed.** PR #78 "feat: add Dragon
Memorize passage practice" was merged, but the local checkout was 20+ commits
behind, so `memory_passages`, `server/routes/memoryPassages.js` and
`src/pages/DragonMemorizePage.jsx` looked absent. `main` was fast-forwarded to
`f8ec90e` and `npm install` re-run (the pull added a `browser` vitest project).

There was no API-key infrastructure at all. Auth was Bearer JWT (`requireAuth`)
plus the static-password `/admin` panel.

Decisions taken (all confirmed by the owner):

| Question | Chosen |
| --- | --- |
| Key ownership | Parent-account keys, scoped by `parent_child_links` |
| Key management UI | A card in the parent dashboard |
| API surface | Read + write, those two content types only |
| Deploy order | Test first, then check back before production |
| Schema push | Dry-run and diff review before applying |

---

## 2. Design, and the two properties worth protecting

A key is a **credential, not a third auth model**. It resolves to its owner's
user row and publishes the same `req.user` a JWT does, so `resolveChildAccess()`
in both content routers runs unchanged and unaware of how the caller identified
themselves. No ownership logic was widened or duplicated.

Two properties hold the blast radius, and both are easy to erase by accident:

1. **Scope comes from mounting, not from a column.** Only `spelling.js` and
   `memoryPassages.js` use `authenticateWithApiKey`. Widening a key's reach
   means editing a router — a visible, reviewable change.
2. **A key cannot manage keys.** `/api/api-keys`' create/list/delete are
   session-only (per-route `requireAuth`, deliberately *not* a `router.use`). A
   key that could mint keys would make a leak unrecoverable: the holder issues
   replacements and deletes the key whose revocation was about to lock them out.
   Signing in is the recovery path, so it must be the only way in.

Only the SHA-256 of the token is stored. A fast hash is right here where it
would be wrong for a password — the secret is 32 random bytes the server
generated, so there is no dictionary to run, and it is looked up by equality on
every request.

### Files

| Piece | File |
| --- | --- |
| Token format, hashing, header parsing (pure) | `server/lib/apiKeys.js` |
| Key → `req.user` | `server/middleware/apiKey.js` |
| Create / list / delete / whoami | `server/routes/apiKeys.js` |
| `api_keys` table | `server/db/schema.js` |
| Dashboard card | `src/components/ApiKeyManager.jsx` |
| Contract + worked examples | `docs/API.md` |

Tests: `server/lib/apiKeys.test.js`, `server/middleware/apiKey.test.js`,
`server/routes/apiKeys.test.js`, `src/components/ApiKeyManager.test.jsx`.

`server/routes/memoryPassages.test.js` faked `../middleware/auth`, which the
router no longer imports; it now fakes `../middleware/apiKey`.

---

## 3. Verification that was actually run

- `npm test` — **437 passed**, 3 files / 22 tests skipped. Identical skip count
  to the pre-change baseline, so no new skips (CI fails on any).
- Lint ratchet at baseline (55 problems, none new); `npm run build` stamps
  `dist/version.json`.
- **End-to-end against a throwaway `postgres:17-alpine` and a real server
  process: 29/29.** Covered cross-parent isolation, the key being rejected on
  `/api/parent`, `/api/billing` and `/api/admin`, key-cannot-mint-a-key,
  stale-revision `409` on passage PATCH, and immediate revocation. The
  connection was proved to point at the throwaway before anything was written.
- Parent-dashboard card checked at 1100px and 390px: no console errors, no
  horizontal overflow.

Two contract details were found only by reading the code, and `docs/API.md` was
corrected to match: passage `PATCH` **replaces the whole passage** and
**requires the `updated_at` you last read** (stale ⇒ `409 passage_changed`), and
changing the wording resets that child's mastery.

### Running the web tests on this box

This box is Node 20; the `web`/`browser` vitest projects need Node 22. Unpack a
tarball into the scratchpad rather than skipping them:

```sh
curl -fsSL -o node22.tar.xz https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz
tar -xf node22.tar.xz
export PATH="$PWD/node-v22.14.0-linux-x64/bin:$PATH"
```

---

## 4. Deploy state

### Merged

PR #80 → `main` as **`52b1150dc07b905467dfdfebc14b6c7f4fdc07f3`**. CI green on
the merge commit itself, which is what `release.sh` checks by name.

The first PR run failed on `Failed to connect to the browser session
[chromium]` — all 448 tests passed, the new `browser` project just never
connected. A clean re-run passed. **Watch for this recurring**; if it does, the
`browser` project needs a retry or a longer connect timeout in CI.

### Test — released, but unhealthy for an unrelated reason

`deploy/release.sh -t test --ref 52b1150…` built, activated the symlink and
reloaded pm2 cleanly, then the health gate failed:

```
/api/health did not report a healthy 52b1150… within 60s (code=503)
```

**The cause is not this change.** The test Supabase project is unreachable:

```
host: aws-0-us-west-1.pooler.supabase.com  user: postgres.palrxtqpdgtpelpyqwwu
DB FAIL: (ENOTFOUND) tenant/user postgres.palrxtqpdgtpelpyqwwu not found
```

The pooler rejects the *tenant*, which is independent of app code — every
release uses that same connection string, so the previous release was equally
503. Test was already broken before the deploy.

The code itself landed correctly: `/api/api-keys` and `/api/api-keys/whoami`
return **401, not 404** (router mounted), and `api_keys` is present in the
deployed `server/db/schema.js`.

The new release was left active rather than rolled back — rollback would land on
an equally unhealthy release, and this is the one wanted once the database is
back. `deploy/rollback.sh -t test` if that judgement is wrong.

### Production — healthy, untouched, still on the old release

`db: ok`, 23 users, serving `f8ec90e`. Different pooler cluster (`aws-1`),
project `sebxkwxhhkiitesligfc`.

---

## 5. Open work

### A. Decide what happened to the test Supabase project — BLOCKED ON THE OWNER

Re-checked 2026-09-13. Still dead, same error, from the box itself:

```
postgres.palrxtqpdgtpelpyqwwu @ aws-0-us-west-1.pooler.supabase.com
FAIL XX000 (ENOTFOUND) tenant/user postgres.palrxtqpdgtpelpyqwwu not found
```

**The Supabase MCP route is a dead end here, and so is the token already in the
environment.** `SUPABASE_ACCESS_TOKEN` is set on this box, so the Management API
can be called with no OAuth round-trip at all — but it belongs to a *different
Supabase account*. Its organizations are `Lindsaria` and `Playground`, it lists
three unrelated projects (`ValleySigns`, `MCOPortfolio`, `CashPlan`), and it
returns **403** for both dragon-math refs:

| Ref | Role | `GET /v1/projects/<ref>` |
| --- | --- | --- |
| `palrxtqpdgtpelpyqwwu` | test | 403 |
| `sebxkwxhhkiitesligfc` | production | 403 |

Production's database is healthy, so that project certainly exists — the token
simply cannot see either one. Don't spend time re-trying it.

What actually resolves this, both needing the owner:

1. Open the Supabase dashboard **for the account that owns
   `palrxtqpdgtpelpyqwwu`** and look at the project: paused (free-tier
   inactivity gives exactly this pooler error) ⇒ resume it and test recovers
   with no code change; deleted ⇒ step 2.
2. If it is gone, a new project is needed, and **two** values must move together
   or test stays dead: `DM_EXPECTED_DB_REF` in `deploy/targets/test.env` (the
   allow-list `db-push.sh` fails closed against) and `DATABASE_URL` in camelot's
   `shared/.env`.

Alternatively, issue a personal access token on the owning account and export it
as `SUPABASE_ACCESS_TOKEN`; the Management API then answers this in one call
(`GET /v1/projects`), no MCP and no interactive session required.

### B. Push the schema

**`api_keys` exists in no real database.** Until it does, `/api/api-keys` errors
and the dashboard card cannot load; nothing else is affected, since nothing else
references the table.

Ordering is forced: `deploy/db-push.sh` reads the schema **from the release tree
on the box**, so the release must land first. There is therefore a window
between activation and the push where the new endpoint errors.

```sh
deploy/db-push.sh -t test --dry-run   # guards only, touches no database
deploy/db-push.sh -t test
```

**The pre-check the next paragraph asks for has already been done statically**
(2026-09-13), and it passes for either target, since both are on `f8ec90e`:
`git diff f8ec90e 52b1150 -- server/db/schema.js` is **purely additive** — it
adds the `api_keys` table and its two indexes and touches nothing else, and the
`.enableRLS()` count goes 9 → 10, so no existing table silently lost its
declaration and would be stripped by the push. That is the RLS half of the
check, not just tables/columns/types. It is evidence, not a substitute: still
read the real `--dry-run` output before applying.

Before applying, confirm the only change is `CREATE TABLE api_keys`.
`drizzle-kit push` also reconciles **RLS**, and comparing tables/columns/types
alone is not enough to call a push non-destructive — see the rule at the top of
`server/db/schema.js`. `api_keys` ends with `.enableRLS()`.

### C. Production — DONE 2026-09-13

Ran, in this order, all exit 0:

```sh
DM_I_MEAN_PRODUCTION=1 deploy/release.sh -t prod --ref 52b1150dc07b905467dfdfebc14b6c7f4fdc07f3 > release-prod.log 2>&1
DM_I_MEAN_PRODUCTION=1 deploy/db-push.sh  -t prod --dry-run
DM_I_MEAN_PRODUCTION=1 deploy/db-push.sh  -t prod   # NOT --force, stdin closed
DM_I_MEAN_PRODUCTION=1 deploy/verify.sh   -t prod
```

Results:

- **Release:** built, symlink swapped, pm2 reloaded, health gate passed, and the
  verify baked into `release.sh` reported **45/45**. `/api/health` now answers
  `52b1150…` with `db: ok`.
- **Push:** applied exactly the predicted statements and nothing else —
  `CREATE TABLE "api_keys"`, `ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY`,
  the `users` FK with `ON DELETE cascade`, and the two indexes. **No
  `DISABLE ROW LEVEL SECURITY` appeared for any other table**, which is the
  check that matters and the one a tables/columns comparison would have missed.
  Table count 31 → 32; `users.username` still `citext`.
- **Verify after the push:** 45/45 again. One pre-existing `warn`, unrelated to
  this work: `ADMIN_PASSWORD` is 11 chars.

Two operational notes learned here, both worth keeping:

- The production guard applies to **`verify.sh` too** — it needs
  `DM_I_MEAN_PRODUCTION=1` even though it only reads.
- `db-push.sh --dry-run` stops *before* drizzle-kit, so it proves the guards and
  shows the resolved project ref but prints **no SQL**. The statement list only
  appears on the real run. Run it without `--force` and with stdin closed: for an
  additive change drizzle-kit applies without prompting, and if it ever does want
  to prompt, the closed stdin turns a silent hang into a fast failure instead of
  a half-applied push.

The activation-before-push window was real but brief: between the symlink swap
and the push, `/api/api-keys` returned 401 rather than erroring, because the
router was mounted before its table existed. No other route touches the table.

### D. Smoke-test a real key — PARTLY DONE, one manual step left

Done from here, without credentials:

```
GET /api/api-keys/whoami  (no credential)  → 401 "Missing or malformed Authorization header"
GET /api/api-keys/whoami  (bogus dmk_ key) → 401 "Invalid API key"
```

The bogus-key result is the meaningful one: reaching "Invalid API key" means the
request got as far as hashing the token and **querying `api_keys` successfully**.
A missing table would have surfaced as a 500 here, so this confirms the push
landed and the lookup path works end to end in production.

**Still to do, and it needs a parent login so it was not done for you:** create a
real key in the parent dashboard (API keys card) and exercise the actual content
routes, not just `whoami` —

```sh
curl -sS -H "X-API-Key: $DM_KEY" https://mydragonmath.com/api/api-keys/whoami
curl -sS -H "X-API-Key: $DM_KEY" https://mydragonmath.com/api/spelling/lists
```

That also confirms the dashboard card renders against a real table, which no
check above covers.

---

## 6. Notes for whoever picks this up

- **This dev box *is* `sondapor`, the production box.** `dragonmath-api-prod`
  runs here from `/srv/dragon-math/current` on `127.0.0.1:4071`. The checkout at
  `~/repos/dragon-math` is unused by the live site. ssh to both `camelot` and
  `sondapor` works from here.
- Production Stripe is **live** (real money). Production also refuses every
  deploy script without `DM_I_MEAN_PRODUCTION=1`; keep that.
- `main` is protected with `enforce_admins`, so everything goes through a PR
  even for the sole maintainer.
