# Content API — open work

What is still unfinished for the parent content-API keys. Everything durable
about the feature lives elsewhere and is not repeated here: the design
invariants are in [AGENTS.md](AGENTS.md) (**Auth boundaries** → parent API
keys), the HTTP contract is [docs/API.md](docs/API.md), the agent-facing brief
is [docs/API_DOCS.md](docs/API_DOCS.md), and the schema rules are at the top of
[server/db/schema.js](server/db/schema.js).

Delete an item from this file when it is done; delete the file when it is empty.

## 1. The test environment's Supabase project is unreachable — needs the owner

> **Likely already resolved.** As of 2026-09-21 `https://test.mydragonmath.com/api/health`
> reports `"checks":{"db":"ok"}`, which is the symptom this item is about.
> Confirm, then delete this item.

The pooler rejects the *tenant* for `DM_EXPECTED_DB_REF` in
[deploy/environments/test.env](deploy/environments/test.env):

```
FAIL XX000 (ENOTFOUND) tenant/user postgres.<test ref> not found
```

That is independent of app code — every revision uses the same connection
string, so `/api/health` answers 503 regardless of what is deployed. Two resolutions, both needing the owner's Supabase account:

1. **Paused project** (free-tier inactivity produces exactly this pooler error)
   ⇒ resume it; test recovers with no code change.
2. **Deleted project** ⇒ create a new one, and move **two** values together or
   test stays dead: `DM_EXPECTED_DB_REF` in `deploy/environments/test.env` (the
   allow-list [deploy/db-push.sh](deploy/db-push.sh) fails closed against) and
   the `DATABASE_URL` secret bound to the `dragon-math-test` Cloud Run service.

The `SUPABASE_ACCESS_TOKEN` exported on the workstation belongs to a different
Supabase account and returns 403 for both dragon-math project refs — it cannot
answer this, so don't spend time re-trying it. A personal access token issued on
the owning account would (`GET /v1/projects`).

## 2. Push the schema to test

`api_keys` does not exist on the test database, so `/api/api-keys` errors there
and the dashboard card cannot load. Nothing else references the table.
Production already has it; do **not** re-push against production.

Blocked on item 1 — the push needs a reachable database. `db-push.sh` now reads
the schema from the **local checkout** (refusing uncommitted changes to
`server/db/schema.js`), so no release has to land first; just push from the
commit that is deployed.

```sh
umask 077
printf 'DATABASE_URL=%s\n' \
  "$(gcloud secrets versions access latest --secret=dragon-math-test-database-url \
       --project honorable-502113)" > /tmp/dm.env
deploy/db-push.sh -e test --env-file /tmp/dm.env --dry-run   # guards only
deploy/db-push.sh -e test --env-file /tmp/dm.env
shred -u /tmp/dm.env
```

`--dry-run` stops before drizzle-kit, so it proves the guards and prints the
resolved project ref but **no SQL**; the statement list only appears on the real
run. Read that list before it applies and confirm the only change is
`CREATE TABLE api_keys` plus its RLS enable, FK and indexes — in particular that
no *other* table gets a `DISABLE ROW LEVEL SECURITY`, which a tables/columns
comparison would miss.

## 3. Smoke-test a real key against production

Needs a parent login, so it could not be done unattended. Create a key from the
parent dashboard's API keys card and exercise the content routes, not just
`whoami`:

```sh
curl -sS -H "X-API-Key: $DM_KEY" https://mydragonmath.com/api/api-keys/whoami
curl -sS -H "X-API-Key: $DM_KEY" https://mydragonmath.com/api/spelling/lists
```

Worked examples for the rest of the surface are in [docs/API.md](docs/API.md).
This also confirms the dashboard card renders against a real table, which no
automated check covers.
