# deploy/ — released-artifact deployment

Production today serves `dist/` straight out of the live git checkout at
`~/repos/dragon-math`, so a build mutates what users are being served and there
is no way back. This directory is the replacement: a deployment is a **release
directory built from one commit**, activated by moving a symlink.

Nothing here is specific to the test box except `targets/test.env`. Adding a
production target is a new file in `targets/`, not new code — including the two
things that differ most between environments: search-engine blocking
(`DM_ROBOTS_NOINDEX`) and whether scheduled jobs are armed (`DM_EXPECT_CRON`).
Both default to the safe answer when a target omits them (blocked, and no cron),
so a forgotten variable cannot make a box indexable or start it emailing
parents.

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
closes the listener and the websockets, finishes in-flight requests, and exits
with a backstop shorter than pm2's `kill_timeout`. Measured after that: 3
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

## Known limitation: cluster mode breaks live PvP

`server/realtime/state.js` keeps presence, challenges and matches in plain
in-process `Map`s, and says so — it was written for a single pm2 process. Under
cluster mode with 2 instances two players land on different workers roughly half
the time and cannot see each other: the presence list is split and challenges do
not route.

Sticky sessions do **not** fix this. The requirement is that two *different*
users share one worker, not that one user is pinned consistently.

This does not affect anything else (the API is otherwise stateless, and rate
limiting is per-process but only becomes more lenient). It does mean **live PvP
must be solved before production adopts cluster mode** — either a shared
backplane (Redis pub/sub) for the realtime state, or routing `/api/rt` to a
single dedicated fork-mode process.
