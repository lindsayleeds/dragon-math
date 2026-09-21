# deploy/ — deployment

Both public environments run on **Google Cloud Run**. Building, releasing,
rolling back and verifying a service is [gcp/README.md](gcp/README.md); that is
the whole deployment contract.

| environment | hostname | Cloud Run service | Supabase project |
| --- | --- | --- | --- |
| test | `test.mydragonmath.com` | `dragon-math-test` | `palrxtqpdgtpelpyqwwu` |
| production | `mydragonmath.com`, `www.mydragonmath.com` | `dragon-math-prod` | `sebxkwxhhkiitesligfc` |

Everything else in this directory is **database** tooling, which has no Cloud
Run equivalent because it acts on the environment's Supabase project rather
than on whatever serves traffic.

## History

Production and test used to be release directories on Linux boxes (`sondapor`
and `camelot`), activated by moving a `current` symlink and served by nginx and
pm2. Test moved to Cloud Run on 2026-09-17, production on 2026-09-18. The boxes
were kept briefly as rollback sources and decommissioned on 2026-09-21, and the
pipeline that drove them — `provision.sh`, `release.sh`, `rollback.sh`,
`verify.sh`, the nginx templates and the pm2 ecosystem file — was removed with
them. `git log` has it if it is ever wanted back.

Cloud Run keeps earlier revisions, so rollback is a traffic change, not a
rebuild. There is no longer any box to ssh to, and nothing here needs one.

## The database scripts

| script | what it does |
| --- | --- |
| `db-push.sh` | push `server/db/schema.js` with drizzle-kit, behind a hard guard |
| `db-harden.sh` | revoke the Supabase Data API's access to the database, behind the same guard |
| `admin-account.sh` | grant or revoke `account_type = 'admin'` for a verified adult — see [../docs/ADMIN.md](../docs/ADMIN.md) |

All three run **locally, from a repo checkout**, and connect straight to the
database. They take:

- `-e <environment>` — `test` or `prod`, read from
  [environments/](environments/). Those files hold non-secret facts only, and
  the one that matters is `DM_EXPECTED_DB_REF`.
- `--env-file <file>` — a mode-600 file assigning `DATABASE_URL` exactly once.
  See [env.example](env.example) for how to write one from Secret Manager and
  shred it afterwards.

A production environment is refused unless `DM_I_MEAN_PRODUCTION=1` is in the
environment. Keep that.

```bash
umask 077
printf 'DATABASE_URL=%s\n' \
  "$(gcloud secrets versions access latest --secret=dragon-math-prod-database-url \
       --project honorable-502113)" > /tmp/dm.env

DM_I_MEAN_PRODUCTION=1 deploy/db-push.sh -e prod --env-file /tmp/dm.env --dry-run
DM_I_MEAN_PRODUCTION=1 deploy/admin-account.sh -e prod --env-file /tmp/dm.env \
  --email person@example.com --action grant

shred -u /tmp/dm.env
```

## Why the guard is the point

`drizzle-kit push` diffs the schema against the live database and drops what it
considers surplus; the repo has no committed migrations, so pushing is the only
way to create a schema. Aimed at the wrong database it is a data-loss event.

So the check is an **allow-list**, not the operator's attention:
`DM_EXPECTED_DB_REF` in `environments/<name>.env` names the Supabase project the
connection string must resolve to, and anything else aborts before drizzle-kit
runs. A deny-list of "not production" would fail open against a typo or a new
project; an allow-list fails closed.

The guard resolves the URL the tooling will **actually** use. That used to take
care, because `drizzle.config.cjs` calls dotenv, which keeps the last duplicate
assignment in a file and does not override a value already in the environment —
so a grep of the file was not the same value. `db-push.sh` now removes the
ambiguity instead of reasoning about it: it refuses an env file with more than
one `DATABASE_URL` line, then exports the guarded value, which by that same
dotenv rule beats the repo's own `.env`.

`db-push.sh` also refuses to run with uncommitted changes to
`server/db/schema.js`. On the retired boxes the push applied a built release,
which could not contain uncommitted edits; this keeps that property.

## Secrets

Application secrets live in Secret Manager, bound to the Cloud Run service.
Never put their values in this repository, a build substitution, or a Cloud Run
plain-text environment variable. The `--env-file` above is the one deliberate
exception, it holds only `DATABASE_URL`, and it is written and shredded inside a
single procedure.
