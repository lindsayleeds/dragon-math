# deploy/ — released-artifact deployment

A deployment is a **release directory built from one commit**, activated by
moving a symlink. Both environments run this way as of the 2026-07-28 production
cutover — before it, production served `dist/` straight out of the live git
checkout at `~/repos/dragon-math`, so a build mutated what users were being
served and there was no way back.

Nothing here is specific to one box: an environment is a file in `targets/`,
not code. `targets/test.env` and `targets/prod.env` both exist. That includes the
things that differ most between environments — search-engine blocking
(`DM_ROBOTS_NOINDEX`), whether scheduled jobs are armed (`DM_EXPECT_CRON`), and
the extra hostnames a site answers on (`DM_HOSTNAME_ALIASES`). The first two
default to the safe answer when a target omits them (blocked, and no cron), so a
forgotten variable cannot make a box indexable or start it emailing parents.

`prod.env` is filled in and in use. Every script still refuses a production
target unless `DM_I_MEAN_PRODUCTION=1` is in the environment — keep that. A
routine production deploy is now just `deploy/release.sh -t prod --ref <sha>`;
the one-time migration is kept below as **How production was cut over** because
the ordering constraints in it apply to any box being migrated onto this
pipeline.

## Layout on the target

```
/srv/dragon-math/
  releases/<full-git-sha>/     one immutable, fully-built commit
    dist/                      vite output (nginx document root)
    server/                    the Express API
    node_modules/              production dependencies only
    .env -> ../../shared/.env  symlink, never a copy
  shared/
    .env                       secrets, mode 600 (owner-only dir)
    previous-release            rollback target, survives a reboot
  acme/                        Let's Encrypt http-01 webroot
  schema-work/                 drizzle-kit workspace (see db-push.sh)
  build-cache.git/             bare clone, only with --source git
  current -> releases/<sha>    what nginx and pm2 both point at
```

`shared/` is `700` because it holds secrets. Everything else is `755` — nginx
runs as `www-data` and has to traverse `current/dist` to serve the site and
`acme/` to answer a certificate challenge. Putting the ACME webroot inside
`shared/` is the mistake that makes certbot fail with a **403**.

## The scripts

All of them run on a workstation and drive the box over ssh, so there is nothing
to install on the server and no step that exists only in someone's shell
history. All are safe to re-run.

| script | what it does |
| --- | --- |
| `provision.sh` | create the layout, install `shared/.env`, install the nginx site, obtain the TLS certificate |
| `release.sh` | build a commit into `releases/<sha>`, activate it, reload pm2, prune old releases |
| `rollback.sh` | point `current` at a previous release and reload |
| `db-push.sh` | push `server/db/schema.js` with drizzle-kit, behind a hard guard |
| `verify.sh` | read-only PASS/FAIL check of the whole deployment |

### First-time setup

```bash
# 1. write shared/.env from deploy/env.example, OUTSIDE the repo, then:
deploy/provision.sh -t test --env-file /path/to/test.env
#    add --skip-tls if DNS does not point at the box yet, and re-run later.

# 2. deploy code
deploy/release.sh -t test --ref main

# 3. create the schema (only needed on a fresh database)
deploy/db-push.sh -t test --force

# 4. prove it
deploy/verify.sh -t test
```

### Routine deploy and rollback

```bash
deploy/release.sh  -t test --ref main     # build, activate, reload, prune, smoke
deploy/rollback.sh -t test --list         # what is available
deploy/rollback.sh -t test                # back to the previous release
deploy/rollback.sh -t test --to <sha>     # to a specific one
```

`--source git` (the default) makes the box fetch the ref from `DM_GIT_REMOTE`.
`--source local` streams `git archive` from your checkout instead — use it for a
commit that is not pushed yet.

## Why the deploy is safe

**The swap is one syscall.** `current` is replaced with `ln -sfn` to a temp name
followed by `mv -T`, which is a single `rename(2)`. The obvious `rm` + `ln`
leaves a window in which the document root does not exist and every request
404s.

**A release directory only appears when it is whole.** The build happens in
`releases/<sha>.incoming` and is renamed into place only after it succeeds, so a
failed deploy cannot be activated and never touches the running site. A leftover
`.incoming` is a failed build and is swept by the next prune.

**Releases are immutable.** They are named by commit, so re-deploying a sha that
is already built re-activates it rather than rebuilding. This is not just an
optimisation: rebuilding the live release would mean `rm -rf` on the directory
nginx is serving. `release.sh` refuses `--rebuild` on the live release for the
same reason.

**Secrets never travel with the code.** `.env` is a symlink into `shared/`, so
rolling the code back cannot restore a stale secret alongside it. The `VITE_*`
values that `release.sh` needs at build time are parsed out of `shared/.env` and
assigned directly — never `eval`'d or sourced. `dotenv` accepts unquoted values
containing spaces and shell metacharacters, and handing such a line to the shell
would abort the deploy on a syntax error at best and execute a `$(...)` from the
secrets file at worst.

**A broken nginx template cannot be left enabled.** `install_nginx_conf` copies
the existing `sites-available` file aside, installs the rendered one, and runs
`nginx -t`; if nginx rejects it the previous file (and, on a fresh host, the
absence of one) is put back and the script exits non-zero without reloading.
`nginx -t` only parses what `nginx.conf` includes, so a config genuinely has to
be enabled to be validated — hence install-then-restore rather than
validate-then-enable. This matters because the box is shared: a rejected config
left enabled would break the next `systemctl reload`, the next reboot, and the
certbot renewal hook for *every* site on the machine, not just ours.

**Reloads are zero-downtime, and that took two things.** pm2 runs in **cluster
mode with 2 instances** (`ecosystem.config.cjs`), so the master holds the
listening socket and workers are replaced one at a time. On its own that still
dropped ~2 requests per 3000 during a reload, because a worker exiting on SIGINT
severs whatever it is mid-response on. `server/index.js` therefore drains: it
closes the listener and idle keep-alive sockets, finishes in-flight requests, and
exits with a backstop shorter than pm2's `kill_timeout`. Measured after that: 3
reloads, 13,378 requests, zero failures.

**pm2 follows the symlink, not a snapshot.** The ecosystem file points at
`current/server/index.js` and `cwd: current`. pm2 stores that string verbatim
(`path.resolve` is lexical), so each respawn re-reads the symlink. That is why a
rollback is just a swap plus `pm2 reload`, with no config rewrite.

## The health gate

`release.sh` does not call a deploy done when pm2 reports "online" — pm2 only
knows the process started. After the reload it polls **`GET /api/health`** (added
in #8) on the box until it returns 200 *and* reports the commit just deployed,
giving up after 60s. One request per iteration, with the status code appended to
the body (`curl -w`), so the code and the version always describe the *same*
response — and the endpoint's bounded database probe runs once per poll, not
twice.

That endpoint reads `dist/version.json` out of the release it is running from and
does a bounded `select 1`, so a pass means this specific release is serving and
can reach its database. A fail leaves the previous release on disk and tells you
to run `rollback.sh` — deciding that automatically belongs to the promote
pipeline, not here.

`verify.sh` asserts the same thing, plus that `/api/health` and
`/version.json` agree on the commit — i.e. the API and the static bundle are from
the same release rather than a half-swapped state.

`GIT_SHA` does not need setting on a target: it is the fallback for hosts with no
built `dist/`, and a release always has one.

## db-push.sh — read this before touching a schema

The repo has **no committed migrations**; production's schema was created by
pushing `server/db/schema.js` directly. `drizzle-kit push` diffs the definition
against the live database and drops whatever it considers surplus, so pointed at
production it is a data-loss event.

The guard is therefore an **allow-list**, enforced in the script rather than left
to the operator: the `DATABASE_URL` must name the Supabase project ref in
`targets/<target>.env` (`DM_EXPECTED_DB_REF`), or the script aborts before
drizzle-kit runs. A "not production" deny-list would fail open against a typo or
a newly created project; an allow-list fails closed. The push also runs *on the
target*, against the target's own `shared/.env`, so a `DATABASE_URL` in the
operator's shell cannot leak into it.

**The guard checks the URL drizzle-kit will actually resolve, not a grep of the
file**, because those are two different values. `drizzle.config.cjs` goes through
`dotenv`, which keeps the **last** duplicate assignment in `.env` and does **not**
override a variable already present in the environment. A guard that read the
first `DATABASE_URL=` line would happily approve the test project while
drizzle-kit pushed to whatever an appended line — or the box's own
`/etc/environment` — named. So the guard resolves it with `node` + `dotenv` from
inside `schema-work/` (the directory drizzle-kit runs in) and refuses outright,
with a distinct message, on either ambiguity: more than one `DATABASE_URL` line
in `shared/.env`, or an ambient `DATABASE_URL` that disagrees with the file.
`verify.sh` reports the same duplicate count, and both it and `provision.sh` read
`shared/.env` last-match so all three agree with `dotenv`.

This is why the schema workspace is prepared *before* the guard: `npm ci` into a
scratch directory touches no database, and it is what lets the guard resolve the
URL exactly as drizzle-kit will. Nothing that can reach the database — not even
`CREATE EXTENSION` — happens until the guard has passed.

Two things the push does not do by itself:

- **citext.** `schema.js` declares usernames as `citext` and drizzle-kit does not
  create extensions, so the script runs `CREATE EXTENSION IF NOT EXISTS citext`
  first. Without it every citext column fails with *type "citext" does not
  exist*.
- **run inside a release.** Releases are pruned to production dependencies, and
  drizzle-kit resolves `drizzle-orm` relative to itself, so `npx drizzle-kit`
  inside a release fails with *please install required packages: 'drizzle-orm'*.
  Installing it into the release would leave the release different from what was
  built, so the tooling gets its own `schema-work/` directory built from the
  release's own `package.json` and lockfile.

## verify.sh

`verify.sh` is the acceptance test — TLS and certificate, the served commit,
`robots.txt` and `X-Robots-Tag`, the cache headers, the API, the release layout,
pm2's mode and instance count, loopback-only binding, whether scheduled jobs are
registered, and which database the box points at.

Its robots and cron assertions follow the target, not a hardcoded environment.
`DM_ROBOTS_NOINDEX` and `DM_EXPECT_CRON` are asserted **in both directions**: with
noindex on, every checked path must carry `X-Robots-Tag: noindex` and
`robots.txt` must disallow everything; with it off, none of them may — a
production target that turned the block off would otherwise keep shipping
`noindex` on its real pages and nothing would notice. Likewise `DM_EXPECT_CRON=0`
(the default) requires the boot log to say jobs were **NOT** registered *and*
`shared/.env` to have `ENABLE_CRON` off, while `1` requires the opposite.

Its HTTPS checks are **pinned to `DM_TARGET_IP` with `curl --resolve`**. Right
after a DNS cutover a resolver can still serve a cached record for the old host,
and an unpinned verifier would then happily report on the wrong server — which
is exactly what happened while this environment was being built. Public DNS is
reported as a warning, never asserted, because a stale cache clears on its own.

## Configuration that must differ on a non-production target

See `env.example` for the annotated list. The two that can cause real-world harm:

- **`ENABLE_CRON=0`.** The weekly digest emails real parents and the orphan
  cleanup deletes children past their grace period. `provision.sh` refuses an env
  file that enables cron on a non-production target, `ecosystem.config.cjs` sets
  `ENABLE_CRON=0` again in the process env, and `verify.sh` reads the boot log to
  confirm nothing was registered (driven by `DM_EXPECT_CRON`, which defaults to
  `0`). Note that a bare truthiness check on this variable is a trap — see
  `server/lib/cronSchedule.js`.
- **`STRIPE_SECRET_KEY`.** `provision.sh` refuses to install an env file
  containing an `sk_live_`/`pk_live_` key on a non-production target, and
  `verify.sh` re-checks it on every run. Both ignore comment lines so a file that
  merely documents the prefixes still installs.

## Extra hostnames (`DM_HOSTNAME_ALIASES`)

Most targets answer on one name. Production answers on the apex *and* `www.`,
both from a single server block, which is what its existing certificate covers.

A target lists the extras space-separated in `DM_HOSTNAME_ALIASES`;
`load_target` folds them into `DM_SERVER_NAMES` with `DM_HOSTNAME` **first**, and
that ordering is load-bearing. certbot names a certificate lineage after its
first `-d`, and both `provision.sh` and `verify.sh` look for the certificate at
`/etc/letsencrypt/live/$DM_HOSTNAME` — reorder it and they point at a lineage
that does not exist.

`provision.sh` sends one `-d` per name on **every** run, which is what makes it
safe to re-run against an existing certificate: certbot matches a request to a
lineage by its full domain set, so omitting an alias does not leave it alone — it
issues a *reduced* certificate and the alias silently stops being served. That
failure is invisible from the apex, so `verify.sh` asserts every alias
individually: on the certificate's SAN list, serving 200 over HTTPS, validating
its own chain, and redirecting from port 80. Each alias check is pinned to
`DM_TARGET_IP` exactly like the apex's.

## Google sign-in needs one manual change per hostname

The app uses Google Identity Services (`google.accounts.id.initialize` in
`src/components/auth/GoogleSignInButton.jsx`) and verifies the returned **ID
token** server-side. That flow has **no redirect URI** — it is gated on
*Authorized JavaScript origins*. To enable the Google button on a new hostname,
add the origin to the OAuth client in Google Cloud Console → APIs & Services →
Credentials:

```
Client ID:  987495495898-grh7dn41c5o1taf3emmo38rlsakhqmaj.apps.googleusercontent.com
Add to:     Authorized JavaScript origins
Value:      https://test.mydragonmath.com
```

Nothing needs to go in *Authorized redirect URIs*. Until the origin is added,
the Google button renders but sign-in fails; **email + password signup and login
work regardless**, and are not affected by this.

Note that `VITE_GOOGLE_OAUTH_CLIENT_ID` is baked into the bundle at build time,
which is why `release.sh` installs the `.env` symlink and exports the `VITE_*`
variables *before* running `vite build`. A release built without it renders a
permanently disabled button no matter what the server environment says later.

## Cluster mode is safe on any target

This used to carry a blocker: live PvP kept presence, challenges and matches in
in-process `Map`s, so under cluster mode two players landed on different workers
roughly half the time and could not see each other. Sticky sessions were no help,
because the requirement was that two *different* users share one worker.

**Live PvP has been removed**, along with the `/api/rt` websocket, so that
constraint is gone: the API is stateless, rate limiting counts in the
`rate_limits` table, and no endpoint upgrades a connection. Cluster mode with
`DM_PM2_INSTANCES=2` — the thing that makes `pm2 reload` zero-downtime — is now
the right default for production as well as test.

Anything reintroducing cross-user live state has to be shared from the start
(Redis pub/sub or equivalent), not an in-process `Map`.

## How production was cut over

Production (`mydragonmath.com`, box `sondapor`) still serves `dist/` out of the
live git checkout at `~/repos/dragon-math` with a hand-started fork-mode pm2
process named `dragonmath-api` on `127.0.0.1:4070`. Moving it onto this pipeline
is a one-time procedure, not a `release.sh` run, and it has three properties
worth understanding before starting.

**The two stacks run side by side.** `prod.env` deliberately uses a different
pm2 app name (`dragonmath-api-prod`) and port (4071) from the live process. The
new stack is provisioned, deployed and verified while the old one is still
serving; only then does nginx move. Reusing the old name would make
`pm2 startOrReload` adopt the running app and take the site down as its first
act. sondapor is shared with ~10 other pm2 apps, so confirm 4071 is free first.

**nginx moves last, and that is the whole shape of the procedure.** Everything
before it is additive — a layout, an env file, a second pm2 app on a second port
— and none of it is visible to a visitor. The cutover is one nginx reload, which
is also the one step with an automatic undo (`install_nginx_conf` restores the
previous config if `nginx -t` rejects the new one). This is why `provision.sh`
grew `--skip-nginx`: it is the only way to establish the layout that `release.sh`
requires without simultaneously pointing the live document root at a release that
does not exist yet.

**`verify.sh -t prod` cannot be green until after the cutover.** Roughly half its
checks describe the release layout — `current`, `releases/<sha>`, the pm2 app name,
`shared/.env` — and the rest go through the public hostname, which still reaches
the old stack. Run it at step 4 for the former and expect the latter to fail.
(`/api/health` is also absent from what production runs today, which predates it;
`release.sh` handles that by falling back to pm2's verdict, but only the first
deploy needs it.)

**The schema push is the only irreversible step, and it cannot come first.**
`db-push.sh` runs *on the target*, against that box's own `shared/.env`, out of a
`schema-work/` directory built from the release's `package.json` — so it needs the
layout and a release to exist before it can run at all. It therefore lands
between the release and the cutover, which is also where it belongs: the schema is
in place before any user traffic reaches the new code, and no traffic reaches it
before that.

Production is several commits behind, and the Postgres rate limiter is among what
it is missing — that code wants a `rate_limits` table the production database does
not have. It fails open by design, so nothing breaks in the window between the
release starting and the push landing, and no users are on it anyway. But
`drizzle-kit push` drops whatever it considers surplus and this repo commits no
migrations, so **take a Supabase backup before every push**, not just the first.
`--dry-run` prepares the workspace and runs every guard without touching the
database; use it first, always.

```bash
export DM_I_MEAN_PRODUCTION=1              # every script below refuses without it
SHA=<the sha already verified on test>

# 1. layout + shared/.env ONLY. --skip-nginx is not optional here: installing
#    the site config points the document root at `current` and the proxy at
#    4071, and neither exists yet, so a plain provision would black the live
#    site out until step 2 finished — or indefinitely, if it failed.
deploy/provision.sh -t prod --env-file /path/to/prod.env --skip-nginx

# 2. build and start the released stack on 4071, alongside the running site.
#    --skip-smoke because release.sh's smoke step is a full verify.sh, and
#    verify.sh checks the PUBLIC hostname — which nginx still routes to the old
#    stack. Without the flag a good deploy reports failure. The health gate
#    still runs: it polls 127.0.0.1:4071 on the box, so it is unaffected.
deploy/release.sh -t prod --ref "$SHA" --skip-smoke

# 3. back up the production database from the Supabase dashboard. Then prove the
#    guards pass, and only then push. This is the irreversible step.
deploy/db-push.sh -t prod --dry-run
deploy/db-push.sh -t prod --force

# 4. prove the new stack before any traffic reaches it. The HTTPS and
#    served-commit checks still describe the OLD stack and will FAIL here; that
#    is expected. What must pass is the release layout, the pm2 topology, the
#    loopback bind, and shared/.env.
deploy/verify.sh -t prod --expect-commit "$SHA" || true

# 5. the cutover itself: install the rendered nginx site and reload. One
#    `systemctl reload nginx`, with the previous config restored automatically
#    if nginx rejects the new one.
deploy/provision.sh -t prod

# 6. now the whole thing must be green, including www and the served commit
deploy/verify.sh -t prod --expect-commit "$SHA"

# 7. retire the old process only once step 6 is green
ssh sondapor 'pm2 delete dragonmath-api && pm2 save'
```

To roll back before step 5, nothing needs undoing: the old stack never stopped
serving, so `pm2 delete dragonmath-api-prod` is enough. Between steps 5 and 7 the
way back is to restore the previous nginx config (`provision.sh` left a copy) and
reload. After step 7 it is the normal `deploy/rollback.sh -t prod`.

Rollback at any point before step 6 is `pm2 delete dragonmath-api-prod` plus
putting nginx back — the old stack never stopped serving. After step 6 it is the
normal `deploy/rollback.sh -t prod`.

Two things to settle before the first weekly digest fires, because `prod.env`
sets `DM_EXPECT_CRON=1` and production is the only target that arms cron:
`shared/.env` needs `ENABLE_CRON=1`, and it needs a working `RESEND_API_KEY`
with it — without the key the digest job logs a send it never performed
(issue #2), which is worse than being off.
