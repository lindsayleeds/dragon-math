# Dragon Math — Project Notes

## Theme & content preferences

- **No dark/spiritual/occult themes.** Avoid witches, wizards, ghouls, zombies, demons, necromancy, séances, hexes, curses, dark magic, or any occult/spiritual-dark imagery in node names, icons, copy, art, or game content.
- Keep the world wholesome and nature-forward: animals, plants, weather, gems, cozy dwellings, friendly creatures, mythical-but-bright themes (dragons in the boss role are fine).
- When generating new map nodes, enemies, items, or flavor text, choose names/icons that fit this tone without being asked.
- **Clean & Clear (`clean`) is the intended default font for everyone** — kids,
  guests, and grown-ups. Handwritten is a choice a kid opts into, never a
  starting point. Three places decide a default and must agree:
  `DEFAULT_FONT_THEME` in [src/data/fontThemes.js](src/data/fontThemes.js),
  `DEFAULT_FONT` in [server/routes/auth.js](server/routes/auth.js), and the
  `font` column default in [server/db/schema.js](server/db/schema.js). The
  **column default is the one that governs a real child**, because no child
  insert site passes `font` — so a frontend-only fix looks right for guests and
  parents while every newly created kid still lands on the old value. Changing
  it needs [deploy/db-push.sh](deploy/db-push.sh), and it only affects rows
  created after the push; don't backfill existing `font` values, since a stored
  `handwritten` can't be told apart from a kid who picked it.

## Auth boundaries

- **Two independent auth models.** The `/admin` super-admin panel
  ([AdminPage](src/pages/AdminPage.jsx)) is gated by a static password header
  (`x-admin-password` → `requireAdmin`, [server/middleware/admin.js](server/middleware/admin.js)),
  with **no** session/JWT. Everything else uses a Bearer JWT (`requireAuth`) and
  per-resource DB scoping — e.g. school-admin views authorize via `school_admins`
  membership (`requireSchoolAdmin`, [server/middleware/auth.js](server/middleware/auth.js)).
  To surface session-scoped data in the password-gated admin panel, add a
  `/api/admin/*` endpoint that reuses the shared query helper and is gated by
  `requireAdmin` — never widen `requireSchoolAdmin`/`requireOwns*` for the admin.
  The one deliberate exception to both models is `GET /api/health`, which is
  unauthenticated and unthrottled on purpose — see the deploy-contract entry
  under **Build & bundling**; don't "fix" it by adding a guard.
- **The API is loopback-only, on purpose.** It binds `127.0.0.1` unless `API_HOST`
  says otherwise ([server/lib/bindHost.js](server/lib/bindHost.js)) so nginx's
  TLS can't be bypassed by hitting the box directly — the network ACL is not the
  control here. Don't reintroduce a wildcard bind; the topology and the cluster-mode
  reasoning are in [docs/NGINX.md](docs/NGINX.md).
- **Rate limiting is shared state, and `rateLimit()` is async.**
  `await rateLimit({ key, limit, windowMs })`
  ([server/lib/rateLimit.js](server/lib/rateLimit.js)) counts in the `rate_limits`
  table, not in process memory: production is moving to pm2 cluster workers, and
  an in-memory counter handed each worker its own copy of every brute-force limit.
  Always `await` a new call site — an unawaited call reads `allowed` off a
  Promise and 429s every request (`server/lib/rateLimit.test.js` audits the
  routes for this). It fails **open** on a database error by design, and expired
  rows are swept by the same statement that counts, so don't add a timer.
- **School views share one data source.** `schoolDetail()`/`schoolStudents()` in
  [server/routes/school.js](server/routes/school.js) back both the school admin's
  own dashboard (`/api/school/:id`) and the super-admin drill-in
  (`/api/admin/schools/:id`), so both show identical data.

## Layout & mobile

- **Floating "← back" tabs sit at `top: 47px`.** These absolutely-positioned
  back tabs in the top-left corner (the `.backTab` class in
  [DragonCollectionPage](src/styles/DragonCollectionPage.module.css),
  [LearningLair](src/styles/LearningLair.module.css),
  [ClassroomPage](src/styles/ClassroomPage.module.css), and
  [DragonSpelling](src/styles/DragonSpelling.module.css) module CSS) must clear
  the iOS status-bar clock in the standalone/home-screen PWA. At lower offsets
  the clock overlaps them and they can't be tapped. Use `top: 47px` for any new
  floating top-left button. (More robust still: `top: calc(22px +
  env(safe-area-inset-top))`, but the fixed `47px` is what's used today — keep
  new ones consistent.) Back buttons that live in normal flow inside a padded
  header (BattlePage/Settings `.backBtn`) don't have this problem.

## Database

- **Stack:** Drizzle ORM + `pg` against Supabase Postgres. The Session pooler
  is used (supports prepared statements). `DATABASE_URL` lives in `.env` —
  see `.env.example`.
- **Schema source of truth:** [server/db/schema.js](server/db/schema.js).
  Drizzle Kit pushes it to Supabase: `npx drizzle-kit push --config=drizzle.config.cjs`.
- **Entrypoint:** every server file goes through
  [server/db.js](server/db.js) — normally `{ db, schema }`. `db.execute(sql\`...\`)`
  is the escape hatch for raw queries when the Drizzle builder would be noisier
  than helpful (e.g. the aggregate-heavy queries in `server/lib/analytics.js`).
  The exported `pool` is checked out directly by two callers: the health probe,
  for the reason its entry under **Build & bundling** gives, and
  `withLongQueryBudget` below.
- **The pool is bounded, and the bounds are env-tunable.**
  [server/lib/pgPool.js](server/lib/pgPool.js) owns the acquisition timeout,
  idle timeout, `statement_timeout`, `idle_in_transaction_session_timeout` and
  TCP keepalive, the `DB_*` env overrides for each (listed in `.env.example`),
  and the pool `error` listener that keeps a Supabase failover from killing this
  single-instance process. Two things there are easy to get wrong and are
  commented at length in the file: the timeouts are applied with `SET` on each
  new connection rather than as pg's startup-packet parameters (a pooler may
  reject an unknown startup parameter, which would break the connection, not
  just the timeout; Supabase honours session-level `SET` on the session pooler
  port 5432), and pg's client-side `query_timeout` is deliberately unused
  because it abandons a query still running on the socket. Anything that can
  legitimately outrun the pool-wide budget uses `withLongQueryBudget` from
  [server/db.js](server/db.js) — today only the `/api/admin` roster reports.
  Behaviour is pinned by [server/db.timeouts.test.js](server/db.timeouts.test.js);
  see **Tests**.
- **`pool.query()` destroys the connection on *any* query error** — pg-pool
  releases the client with the error, and pg drops rather than pools an errored
  socket. So a burst of cancelled queries costs reconnects. A client taken with
  `pool.connect()` and released without an error argument is reused instead,
  which is why the health probe and `withLongQueryBudget` take that path.
- **Usernames are `citext`** — `WHERE username = ?` and `ORDER BY username` are
  case-insensitive by default. Don't add `lower()` or COLLATE clauses.
- **`play_minutes.minute` stays as `text 'YYYY-MM-DD HH:MM'` in the server's
  local TZ.** Postgres has no `localtime` modifier, so the comparison strings
  are computed in JS by [server/lib/localTime.js](server/lib/localTime.js)
  (dependency-free on purpose — `node scripts/check-local-time.cjs` exercises
  the date maths with no DB; run it under a few `TZ=` values after touching it).
  [server/routes/playtime.js](server/routes/playtime.js) re-exports the helpers,
  which is how admin/parent/school/classroom still import them; new code should
  require `server/lib/localTime` directly, as `server/lib/analytics.js` does.
- **Two different "windows", don't mix them up.** `buildAnalytics(id, { days: N })`
  is a *rolling* N×24h cutoff, so it never lines up with a calendar day.
  Anything day-scoped (the parent's "today" card) uses `localDayRange()` —
  half-open `[local midnight, next local midnight)` in the **server's** TZ, the
  same clock `play_minutes` is keyed on — and is recomputed per request so it
  rolls over on its own. Day-scoped payloads carry the `timezone` they were
  computed in so clients render times in the same frame of reference. A third
  kind is neither: `proving_grounds_runs` rows are *events*, returned unwindowed
  and newest-first as plain `timestamptz`, so they render in the reader's
  timezone — don't fold them into `buildAnalytics`'s `days` payload.
- **`SUM()` over an empty window returns NULL, `COUNT()` returns 0.** The shared
  aggregates in [server/lib/analytics.js](server/lib/analytics.js) `COALESCE`
  the win counts so a quiet window can't report `total: 0` next to
  `child_wins: null`. Averages stay nullable — no attempts means no pace.
- **AVG() casts to `::float8`.** Without the cast, Postgres returns `numeric`
  which `pg` deserializes as a string, breaking the JSON shape the frontend
  expects.
- **No SQLite anywhere.** `better-sqlite3` was dropped in the Phase 4 cleanup and
  no code path touches a `.db` file. Three artifacts survive as *history only*,
  each with a HISTORICAL header and none runnable (they still
  `require('better-sqlite3')`): `scripts/migrate-sqlite-to-postgres.cjs`,
  `scripts/migrate-insert-honey-world.cjs`, `scripts/retune-difficulty.cjs`.
  [DB_MIGRATION.md](DB_MIGRATION.md) is the completed cutover plan, kept because
  the repo has **no committed Drizzle migration directory** — it is the only
  record of why the schema looks as it does. Don't cite any of them as current
  state, and don't re-type schema details out of them; point at
  [server/db/schema.js](server/db/schema.js).


## Tests

- **`npm test` runs two vitest *projects*, and they must stay apart** — see
  [vitest.config.js](vitest.config.js). `server` is CommonJS on Node with no
  DOM; `web` is `src/**/*.test.jsx` under jsdom with the React plugin (that
  project declares `plugins: [react()]` itself — it does **not** inherit
  `vite.config.js`, and without it every `.jsx` import fails to parse). Run one
  with `npx vitest run --project web`. `src/test/setup.js` clears
  localStorage between tests and stubs `HTMLMediaElement.play`.
- **`vi.mock()` DOES work in `src/`** — the opposite of the server rule below.
  Frontend code is ESM, so mock `../api` and `../utils/soundEffects` (no audio in
  jsdom) directly. Prefer `importOriginal` to pin only the random parts, as
  [useBattle.test.jsx](src/hooks/useBattle.test.jsx) does with `battleData`.
- **The React tests are targeted, not comprehensive.** They exist so the
  react-hooks findings still recorded in `.eslint-baseline.json` can be fixed
  safely, and they cover [useDragonTrial](src/hooks/useDragonTrial.test.jsx),
  [useBattle](src/hooks/useBattle.test.jsx),
  [useNodeProgress](src/hooks/useNodeProgress.test.jsx),
  [DragonEggHatchery](src/components/DragonEggHatchery.test.jsx) and
  [DragonMunchers](src/components/DragonMunchers.test.jsx). They assert the
  *late-firing* consequences a render-phase ref protects — which op an answer
  scores against, which cell the opponent eats, what an abandoned match reports,
  that the board is not re-dealt on re-render — rather than the refs themselves,
  so a correct refactor keeps them green. Everything else in `src/` (all pages,
  the other games) still has no coverage.
- **[App.routes.test.jsx](src/App.routes.test.jsx) is the exception, and it exists
  for dependency bumps.** react-router reaches 33 files with no coverage, so a
  react-router or react bump could only be checked by hand-clicking the app —
  and Dependabot now proposes those weekly. It asserts the route table's own
  decisions (where an unauthenticated visitor is sent, that a lazy chunk resolves
  through `<Suspense>`, that a teacher on `/parent` is routed on) against
  `window.location.pathname`, because page copy changes and those contracts don't.
  It fakes only `<AuthProvider>` — replaced by a passthrough publishing a
  controlled value on the real `AuthContext`, which is possible *because* the
  context object lives in its own module; the real provider would make every
  assertion wait on `/api/auth/me`. Everything else is the real library.
  Two things to know before extending it: assert a **final** destination, since
  guards chain (a redirect to `/home` with no session lands on `/auth`, which
  makes a naive mutation look undetectable), and the loading guards in
  `AppRoutes` and in each `Require*` shadow each other, so only removing both
  changes observable behaviour. `App` is a **default** export while the lazy
  pages are named — mixing those up is what "Element type is invalid" means.
- **Two traps when adding React tests.** Fake timers plus RTL means every timer
  advance needs its own `await act()`; and several clicks inside ONE `act()` are
  batched, so a multi-step interaction (walking the muncher) must `act()` per
  step or every later step is computed from a stale position. Module-level caches
  outlive a test file's individual tests — `useNodeProgress` keeps one, so its
  tests use a distinct username each.
- **One test needs docker.** [server/db.timeouts.test.js](server/db.timeouts.test.js)
  boots a throwaway `postgres:17-alpine` and drives the real pool through
  `pg_sleep` to prove the timeouts cut queries off, free the slot, and let the
  process keep serving. It skips itself (loudly) with no docker, so a green run
  on a docker-less box does not mean that behaviour was checked.
- **Server code is CommonJS, so `vi.mock()` does not intercept it.** `vi.mock`
  can't reach the `require()` calls inside a CJS module here; wire fakes the
  plain Node way instead — patch `Module._load` for bare deps and replace methods
  on the object `require('../db')` returns (it's the same reference the route
  destructured). Worked example:
  [server/routes/billing.portal.test.js](server/routes/billing.portal.test.js).
- **`*.pg.test.js` files need a real Postgres and skip without one.** Run them
  with `TEST_DATABASE_URL=postgres://…/scratch_db npm test`; they truncate the
  tables they own, so point them at a scratch database, never at
  `DATABASE_URL`'s.
- Prefer keeping decision logic in a **pure** `server/lib/*.js` module so it can
  be tested without mocking db/Stripe at all (e.g.
  [server/lib/stripeCustomers.js](server/lib/stripeCustomers.js)).
- **Lint grants globals per runtime, never repo-wide.**
  [eslint.config.js](eslint.config.js) has a no-globals baseline block plus one
  block per runtime: browser (`src/**`, `solve-game.js`), CommonJS-on-Node
  (`server/**/*.js`, `**/*.cjs`), ESM-on-Node (root `*.config.js`,
  `scripts/**`), and vitest. That split is the point — `no-undef` must keep
  firing on `document` in a server file *and* `process` in a `src/` file, so put
  a new file in the block matching where it actually runs rather than widening an
  existing one. Node-side lint is clean; the remaining ~80 errors are
  pre-existing frontend ones in `src/` (React hooks/refresh, unused vars), so
  compare against that baseline rather than expecting zero.
- **The lint gate is a ratchet, and the baseline is a file.** `npm run lint:ci`
  ([scripts/lint-baseline.mjs](scripts/lint-baseline.mjs)) runs `eslint .` and
  fails only where a count in `.eslint-baseline.json` went **up**, recorded per
  file *and* per rule. Two properties to preserve: a file **absent** from the
  baseline must lint clean — that, not a second allow-list, is what holds
  `server/` at zero — and fixing something prints a notice instead of failing,
  so run `npm run lint:baseline` to lock an improvement in. Never hand-edit the
  JSON, and don't record a new problem into it to get green.
- **CI is [.github/workflows/ci.yml](.github/workflows/ci.yml): three jobs on
  every PR** — `test`, `lint`, `build`. **Nothing skips there, and that is
  asserted, not assumed**: CI supplies both opt-in server dependencies — a
  `postgres:17-alpine` service as `TEST_DATABASE_URL` for the `*.pg.test.js`
  files, and docker for `server/db.timeouts.test.js` (which boots its own
  container on an ephemeral port, so it doesn't collide with the service) — and
  then a `No test skipped itself` step fails the job if the skip count isn't
  zero. Both of those files skip themselves *silently and green* without their
  dependency, so a service container that failed to come up would otherwise have
  left `test` passing while covering less than a laptop does. A consequence worth
  knowing: **no test here may be permanently skipped** — an `it.skip` for a
  known-broken case lands as a CI failure, so delete it or fix it. Don't restate
  test counts in prose; they rot (this bullet carried wrong arithmetic for a
  while). Run `npm test` for the number.
  CI also does what nothing else does: `scripts/check-local-time.cjs` under four
  timezones, an assertion that `npm run build` still stamps `dist/version.json`,
  and `bash -n` plus **shellcheck** over every tracked `*.sh`. It holds **no
  secrets and never deploys** — keep it that way; `DATABASE_URL` and the
  Stripe/Resend keys stay out.
- **Third-party actions are pinned to commit shas, and Dependabot is what keeps
  that from freezing.** A `v4`-style tag is a moving target the upstream owner
  repoints, so [.github/dependabot.yml](.github/dependabot.yml) proposes bumps
  (npm + github-actions, weekly, grouped) that the three checks then gate — and
  it rewrites both the sha *and* its trailing `# v7.0.1` comment, so keep that
  comment accurate. Dependabot is also the only thing that reports a dependency
  CVE; its config records why that is not an `npm audit` step. Note Dependabot
  posts its own check runs on every commit, which matters to the deploy gate —
  see **Deployment**.
- **`main` is protected, and admins are not exempt.** The three checks are
  required, `enforce_admins` is on (so the sole maintainer cannot push past the
  gate), and `strict` is on — a PR must be up to date with `main` before merging,
  because two PRs that are each green alone can break `main` together. Expect to
  update a branch that has sat for a while; that is the setting working.
- **The shell gate is clean at default severity, and its flags are load-bearing.**
  `shellcheck -x -P SCRIPTDIR` over `git ls-files '*.sh'`, pinned to `v0.11.0`
  in the workflow — `-x` follows the sourced
  [deploy/lib/common.sh](deploy/lib/common.sh) and `-P SCRIPTDIR` resolves it
  relative to each script instead of the repo root; drop either and you get nine
  false positives. Every real exception is a `# shellcheck disable=` **with a
  reason** at the site (envsubst's literal `$NAME` allow-list, nginx config text
  that only looks like a command, `rsh`'s deliberate client-side expansion), so
  fix findings or annotate them there — never widen the CI command with
  `--exclude`. One trap it can't see: a directive binds to the next *command*, so
  on a `set -a; . "$f"; set +a` one-liner it lands on the `set` and silently does
  nothing.

## Build & bundling

- **Every route except `/auth` is lazy.** [src/App.jsx](src/App.jsx) declares
  pages through its local `lazyPage(load, name)` helper (pages are named
  exports, so it maps the name onto `default`), under one `<Suspense>` in
  `App`. **Add new pages the same way** — a plain top-level `import` silently
  pulls that page and its CSS back into the initial download.
- **Vendor chunks use the rolldown API.** Vite 8 splits via
  `build.rolldownOptions.output.codeSplitting.groups` in
  [vite.config.js](vite.config.js), not Rollup's `manualChunks`. Groups only
  relocate modules, so libs reached solely from lazy routes stay off the
  initial load. `stripe` is server-only — it is not in the client bundle.
- **A deploy strands the chunks an open tab remembers.** `/assets/` is
  `immutable` with `try_files $uri =404` (see [docs/NGINX.md](docs/NGINX.md)),
  so [RouteErrorBoundary](src/components/RouteErrorBoundary.jsx) wraps the
  `<Suspense>` and reloads once into the fresh build. That recovery relies on
  `index.html` staying `no-cache` and on there being no service worker — keep
  new lazy routes inside the boundary; the file's comments own the details.
- **One build identifier, three consumers.** The version plugin in
  [vite.config.js](vite.config.js) stamps `{commit, commitShort, commitDate,
  builtAt}` into `__APP_VERSION__` *and* emits it as `dist/version.json`
  (nginx serves it `no-cache`). `useVersionCheck` polls it for the
  update-available banner, and [server/routes/health.js](server/routes/health.js)
  re-reads the same file so a deploy can confirm which release answered. Keep
  those three reading one identifier.
- **`GET /api/health` is a deploy contract, not just a route.** The
  released-artifact deploy polls it after the pm2 reload and rolls back on any
  non-200, so its status codes (200 healthy / 503 unhealthy) and its bounded
  ~2s DB probe ([server/lib/health.js](server/lib/health.js)) are load-bearing —
  a hang there blocks the rollback instead of triggering it. The probe checks a
  dedicated client out of the shared pool so it can decide that client's fate: a
  round trip it abandons is released *with an error* (pg destroys the connection
  rather than pool a socket with a query still on it), while a checkout that
  merely landed late is released normally. It must not go through `db.execute`,
  which would leave a client pinned per poll. It is deliberately
  unauthenticated, unthrottled, and publicly reachable: add nothing to the body
  that isn't a build id, uptime, or a coarse check verdict.

## Deployment

- **Both environments now use the released-artifact pipeline in
  [deploy/](deploy/README.md)** — production (`mydragonmath.com`, box `sondapor`,
  pm2 app `dragonmath-api-prod` on `127.0.0.1:4071`) was cut over on 2026-07-28,
  and test (`test.mydragonmath.com`, box `camelot`, `dragonmath-api-test` on
  4070). Same shape on both: `/srv/dragon-math/releases/<sha>` activated by an
  atomic `current` symlink swap, secrets in `shared/.env`, pm2 cluster mode with 2
  instances, nginx rendered from `deploy/nginx/site.conf.template`. Production's
  old model — `dist/` served from the live git checkout under a hand-started
  fork-mode process — is **gone**; that checkout at `~/repos/dragon-math` on
  sondapor is now unused. A deploy is `deploy/release.sh -t prod --ref <sha>`,
  and `deploy/verify.sh -t <target>` is the read-only proof of a box's state
  (41 checks on test, measured 2026-07-28; prod runs 3 more for its `www` alias).
  **Never** add a hand-typed server step; every environment difference is a file
  in `deploy/targets/`.
- **Production refuses to be touched by accident.** Every deploy script dies on a
  target with `DM_ENVIRONMENT=production` unless `DM_I_MEAN_PRODUCTION=1` is in
  the environment ([deploy/lib/common.sh](deploy/lib/common.sh)). Keep it: it is
  the difference between a typo'd `-t` and a change to the live site.
- **`release.sh` refuses a commit that has not passed CI, and it checks by NAME.**
  A protected `main` only stops an untested commit from being *merged* — nothing
  stopped `--ref` from naming any commit in the repo. So `check_ci()` requires
  each of `DM_CI_CHECKS` (default `test,lint,build (vite)`) to be present *and*
  completed *and* successful on that sha. Naming them is the load-bearing part:
  a commit carries check runs from **every** app installed on the repo, so an
  earlier version that merely counted successes passed commits where CI never ran
  (Dependabot's own check runs were enough), and would have been blocked by an
  unrelated app's `neutral`. It reads check-runs, not the legacy `/status`
  endpoint, which Actions leaves empty. It fails **closed**: `--skip-ci-check` is
  the deliberate escape hatch, and it is required with `--source local`, since an
  unpushed commit has no CI result to read.
- **Two traps when deploying.** `--ref main` resolves the **local** `main`, so a
  stale checkout silently redeploys the commit you already have — pass an explicit
  sha, or `git fetch origin main:main` first. And never pipe `release.sh` through
  `head`: SIGPIPE kills it mid-build. That is survivable by design (the build
  lands in `releases/<sha>.incoming` and `current` never moves, so the live site
  is untouched and the next run sweeps it) but it looks like a silent failure —
  redirect to a file instead.
- **`ENABLE_CRON=0` is load-bearing and was once a no-op.** The flag is parsed as
  a boolean in [server/lib/cronSchedule.js](server/lib/cronSchedule.js) because
  `'0'` is a truthy string, so the old bare `!process.env.ENABLE_CRON` check armed
  the weekly digest on any box that set it to 0. An explicit off beats
  `NODE_ENV=production`, and only pm2 cluster instance 0 schedules. Keep both
  properties: the digest emails real parents and the orphan sweep deletes rows.
- **Zero-downtime reload needs cluster mode *and* the drain handler.** pm2 cluster
  mode alone still dropped in-flight requests; the SIGINT/SIGTERM drain at the
  bottom of [server/index.js](server/index.js) is what takes it to zero. If you
  add long-lived connections, close them in that handler or `server.close()` will
  hang until the backstop fires.
- **Nothing holds per-process state any more, so cluster mode is safe.** The two
  things that did are both gone: live PvP (presence/challenges/matches in
  in-process `Map`s under `server/realtime/`) was **removed**, and rate limiting
  moved to the `rate_limits` table. There are no websockets left and no
  sticky-session requirement. If you add either back, it has to work across
  workers from the start — a shared backplane, not a `Map`.
- **`drizzle-kit push` is the only way to change a schema (no migrations are
  committed) and it drops what it thinks is surplus.** Always go through
  [deploy/db-push.sh](deploy/db-push.sh), whose allow-list on the Supabase project
  ref fails closed; never point the tool at a `DATABASE_URL` by hand. It
  reconciles more than tables and columns: a push also emits `ALTER TABLE …
  DISABLE ROW LEVEL SECURITY` for any table whose RLS the schema file does not
  declare. Comparing tables/columns/types is therefore **not** enough to call a
  push non-destructive — check RLS too.
- **The Data API has no access to either database, and that is a privilege
  setting, not RLS.** Both projects expose a PostgREST Data API, where a request
  carrying the anon key acts as the `anon` role — so the control is ordinary
  Postgres privilege. Neither project grants `anon`/`authenticated`/`service_role`
  anything on `public` any more: test never did, and production was stripped on
  2026-07-28 with [deploy/db-harden.sh](deploy/db-harden.sh) (25 tables → 0, 42
  sequence grants → 0, schema USAGE removed from those roles and from `PUBLIC`).
  Nothing in the app is affected: it connects as `postgres`, which owns the tables
  and has `bypassrls`, and `@supabase/supabase-js` is not a dependency.
  Two things to keep in mind before "fixing" what looks broken here:
  **DEFAULT privileges were the real bug** — production's `postgres` defaults
  granted `anon` full DML on every *future* table, which is why `rate_limits` was
  born exposed; `db-harden.sh` revokes those too, and the proof is that a freshly
  created table now comes up owner-only. And **9 default-privilege entries owned
  by `supabase_admin` survive** because `postgres` is not a member of that role
  (`42501`); they apply only to objects `supabase_admin` itself creates, not to
  anything drizzle makes, so they are noise rather than exposure. RLS on
  `auth_tokens` stays declared as defence in depth — see the comment there.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
