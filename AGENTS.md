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

- **Admin uses individual sessions.** `account_type = 'admin'` is granted and
  revoked through [deploy/admin-account.sh](deploy/admin-account.sh); see
  [docs/ADMIN.md](docs/ADMIN.md) for bootstrap and operation. `requireAdmin`
  checks both the JWT account type and the current database role on every request,
  and logs actor ID, method, path, and status. No shared admin password remains.
  Keep admin data behind `/api/admin/*` with shared query helpers; never widen
  `requireSchoolAdmin` or `requireOwns*`. `GET /api/health` stays public.
- **JWT_SECRET has no default.** Auth refuses to load without it. It is bound
  to the Cloud Run service from Secret Manager. Never restore a fallback.
- **Parent API keys are a credential, not a third auth model.** A key
  (`api_keys`, `dmk_…`) resolves to its owner's user row and publishes the same
  `req.user` a JWT does, so every downstream ownership check —
  `resolveChildAccess()` in [spelling.js](server/routes/spelling.js) and
  [memoryPassages.js](server/routes/memoryPassages.js) — runs unchanged and a key
  reaches exactly the children its owner is linked to. Two properties hold the
  blast radius and both are easy to erase by accident: what limits a key to those
  two route trees is **where `authenticateWithApiKey` is mounted**, not a scope
  column, so widening it means editing a router; and `/api/api-keys`'s own
  create/list/delete stay **session-only** (per-route `requireAuth`, not a
  `router.use`) because a key that could mint keys would make a leak
  unrecoverable. Only the SHA-256 is stored — a lost token is replaced, never
  recovered. Contract and worked examples: [docs/API.md](docs/API.md); the
  agent-facing brief a parent hands out with a key is
  [docs/API_DOCS.md](docs/API_DOCS.md). **Both are a public surface**: the build
  emits them as plain text at `/agent-api/reference.txt` and
  `/agent-api/instructions.txt` (unauthenticated on purpose — an agent fetches
  its instructions without a login), so editing either ships a published page,
  and anything repo-only in them, such as relative links into `server/`, belongs
  between the `publish:ignore` markers the plugin in
  [vite.config.js](vite.config.js) strips.
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

## API contract (iOS)

- **iOS-used routes have a zod contract in [server/contracts/](server/contracts/index.js),
  and it is three things at once:** the route's input validation (handlers parse
  with it via [parseInput](server/lib/parseInput.js), so its error messages are
  what clients see), the source of the checked-in
  [server/openapi.json](server/openapi.json) that swift-openapi-generator builds
  the iOS client from (`npm run openapi`; a test fails while it is stale), and
  the schema route tests check real responses against with `expectContract`
  from [server/contracts/testing.js](server/contracts/testing.js) — worked
  example [auth.contract.test.js](server/routes/auth.contract.test.js). Only
  iOS-used routes get one (ADR 0006). A component `id` or `operationId` is a
  Swift type or method name, so renaming one is an iOS API change. Response
  schemas stay open (no `additionalProperties: false`) so an older app tolerates
  new fields; the test helper is the strict one, failing any undocumented field.
  `@asteasolutions/zod-to-openapi` is a devDependency: nothing the server loads
  may require [server/openapi/document.js](server/openapi/document.js).

## Learning Lair

- **The lair forks on SUBJECT first** (Math / Spelling / Phonics / Memorize),
  then game, then — for a multi-skill math game — which facts. Every entry in
  [src/data/games.js](src/data/games.js) therefore needs a `subject`, and the
  data test fails without one because a game with no subject is unreachable.
  `subject` and `practices` look redundant and are not: a math game practices
  four operations while belonging to one subject. The skill-filter chips survive
  *inside* a subject and only render when that subject has more than one game.

## Layout & mobile

- **The app root owns the iPhone safe area.** `viewport-fit=cover` is intentional,
  but [global.css](src/styles/global.css) pads `#root` by all four
  `safe-area-inset-*` values so normal-flow controls and controls positioned
  within the root cannot enter a notch, Dynamic Island, or landscape sensor
  area. Keep that global boundary and its regression test; never replace it with
  a device-specific pixel offset. Fixed overlays and absolutely positioned
  controls whose containing block is the viewport may paint behind the inset,
  so their interactive controls must account for the applicable safe-area inset.

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

## Dragon Spelling audio

- **Two audio paths, one fallback.** Built-in GRADE words are static files in
  `public/audio/spelling/`, pre-generated by
  [scripts/generate-spelling-audio.cjs](scripts/generate-spelling-audio.cjs).
  CUSTOM word-list words are generated at save time into the `spelling_audio`
  table by [server/lib/spellingAudio.js](server/lib/spellingAudio.js) and served
  by `GET /api/spelling/audio/<word>.mp3`. Custom words cannot use the static
  path: nginx serves the release symlink's `dist/`, so anything written to
  `public/` at runtime is discarded by the next deploy. Either way
  [speakWord](src/utils/speakWord.js) falls back to browser speech, so missing
  audio degrades rather than breaks.
- **The audio cache is global and keyed by `(word, voice_id)`** — never by user
  or list. A word is paid for once site-wide and reused by every account that
  ever puts it on a list, and rows deliberately outlive the lists that created
  them. Consequence: changing `ELEVENLABS_VOICE_ID` orphans every existing
  custom word (they fall back to browser speech) until
  `npm run spelling:backfill` regenerates them for the new voice.
- **Ambiguous spelling words use one complete spoken prompt.**
  [server/lib/spellingContext.js](server/lib/spellingContext.js) asks Claude
  whether a new custom word needs context and, when it does, ElevenLabs records
  `word → sentence → word` as one MP3. The sentence is cached beside the audio
  for the browser-voice fallback. Built-in prompt choices live in
  [src/data/spellingPrompts.js](src/data/spellingPrompts.js); the offline audio
  generator applies the same AI check to newly added catalog words.


## Dragon Phonics

- **The curriculum is frontend data and the server does not have it.**
  [src/data/phonicsCurriculum.js](src/data/phonicsCurriculum.js) holds all 102
  sound-spellings across 8 stages, and an element's `key` is a permanent
  identifier used for three things at once: the question, the stored mastery
  (`phonics_attempts.element_key`), and the audio filename
  (`public/audio/phonics/<key>.mp3`). Renaming one orphans a child's progress
  AND its clip — add a new element instead. The server validates that key by
  *shape*, never by membership, so adding a sound needs no deploy; the flip side
  is that `GET /api/phonics/mastery` only reports sounds a child has attempted
  and the client fills in the rest (`fullMastery()` in
  [usePhonicsProgress.js](src/hooks/usePhonicsProgress.js)). Three keys look
  duplicated and are not: `st`/`sk`/`sp` are beginning blends, and the ending
  blends are `end-st`/`end-sk`/`end-sp`, because hearing /st/ in "star" and in
  "nest" are different skills.
- **Phonics is sound-first, so an element is one SOUND with many spellings.** A
  child hearing /ā/ cannot know whether it is `ai` or `ay` — that is spelling,
  which Dragon Spelling covers. Every legitimate spelling is in `accepts`: the
  type-it game marks any of them right, and the multiple-choice game keeps the
  others out of the distractor pool, because an item with two correct tiles is
  an unfair item. `src/data/phonicsCurriculum.test.jsx` asserts that exhaustively.
- **Isolated-sound audio cannot come from speech synthesis, and that is the
  whole reason the clips exist.** A synthesiser handed "br" reads the letter
  NAMES. The 102 clips are pre-generated by
  [scripts/generate-phonics-audio.cjs](scripts/generate-phonics-audio.cjs) from
  each element's `arpabet` (wrapped in an ElevenLabs `<phoneme>` tag — only the
  *English* models honour it) and committed like the spelling files.
  [speakSound.js](src/utils/speakSound.js) falls back to speaking an example
  word, which keeps the game playable while making it a strictly easier task, so
  a missing clip degrades the measurement rather than the app. A generated
  phoneme is **not self-verifying**: after a run, listen to a sample.
- **Mastery is derived at read time and needs TWO game modes.** The rule is a
  pure function in [server/lib/phonicsMastery.js](server/lib/phonicsMastery.js)
  (no DB, no imports) and is applied to stored attempts on every read, so
  tightening it re-judges a child's whole history instead of only their future —
  never write a verdict to a column. The load-bearing part is that a perfect
  streak in ONE mode tops out at `solid`: tapping a tile is recognition and can
  be passed by elimination, typing the letters is recall, and finding the sound
  in a spoken word is analysis. `mastered` needs correctness in at least two of
  them, judged on the last `RECENT_WINDOW` attempts. Mastery goes **stale**
  rather than being revoked. The kid's Sound Map and the parent report are the
  same `buildReport()` for this reason — they must not be able to disagree.
- **Two pools when building a round, and conflating them breaks the game.**
  `buildRound()` in [src/data/phonicsRounds.js](src/data/phonicsRounds.js) draws
  QUESTIONS from a pool a review list may narrow to a handful, but DISTRACTORS
  from the whole curriculum — a three-sound review list otherwise renders
  three-tile questions. The find-in-word mode additionally excludes any sound
  that really is in the spoken word ("brick" contains /br/ *and* /ck/ *and* /ĭ/).
- **Missing Sound feeds the same record.** The older word-frame game keeps its
  own three levels and hand-segmented data
  ([phonicsWords.js](src/data/phonicsWords.js)), but `curriculumKeyFor()`
  translates its blanked grapheme — *positionally* — into an element key so its
  attempts reach the same Sound Map.

## Tests

- **`npm test` runs three vitest *projects*, and they must stay apart** — see
  [vitest.config.js](vitest.config.js). `server` is CommonJS on Node with no
  DOM; `web` is `src/**/*.test.jsx` under jsdom with the React plugin (that
  project declares `plugins: [react()]` itself — it does **not** inherit
  `vite.config.js`, and without it every `.jsx` import fails to parse); and
  `browser` runs `*.browser.test.jsx` in headless Chrome through Playwright for
  layout assertions that jsdom cannot make. Run one with
  `npx vitest run --project web`. `src/test/setup.js` clears localStorage and
  sessionStorage between web tests and stubs browser APIs that jsdom does not
  implement, such as media playback and `window.scrollTo`.
- **`vi.mock()` DOES work in `src/`** — the opposite of the server rule below.
  Frontend code is ESM, so mock `../api` and `../utils/soundEffects` (no audio in
  jsdom) directly. Prefer `importOriginal` to pin only the random parts, as
  [useBattle.test.jsx](src/hooks/useBattle.test.jsx) does with `battleData`.
- **The React tests are targeted, not comprehensive.** They exist so the
  react-hooks findings still recorded in `.eslint-baseline.json` can be fixed
  safely, and they cover [useDragonTrial](src/hooks/useDragonTrial.test.jsx),
  [useBattle](src/hooks/useBattle.test.jsx),
  [useNodeProgress](src/hooks/useNodeProgress.test.jsx),
  [DragonEggHatchery](src/components/DragonEggHatchery.test.jsx),
  [DragonMunchers](src/components/DragonMunchers.test.jsx),
  [PhonicsGame](src/components/PhonicsGame.test.jsx), the Dragon Memorize
  page, passage editor, and text helpers, the router-level
  [ScrollToTop](src/components/ScrollToTop.test.jsx) regression, and the
  [GoogleSignInButton](src/components/auth/GoogleSignInButton.test.jsx) one.
  The hook and game tests assert the *late-firing* consequences a render-phase
  ref protects — which op an answer scores against, which cell the opponent
  eats, what an abandoned match reports, that the board is not re-dealt on
  re-render, that a double tap is not scored against the NEXT phonics sound and
  that a finished round saves exactly once — rather than the refs themselves, so
  a correct refactor keeps them green. (`usePhonicsRound` gets the same
  protection from one state object read through functional updaters instead of a
  ref, and those tests pass either way, which is the point.) The scroll regression pins the Learning Lair → Dragon Phonics route
  transition; the Google one pins that a parent re-render does not re-initialize
  Google Identity Services, and that a credential parked by
  [pendingGoogleCredential](src/utils/pendingGoogleCredential.js) is resumed by
  the page that comes back from a teardown mid-exchange. The two phonics data
  suites ([phonicsCurriculum](src/data/phonicsCurriculum.test.jsx),
  [phonicsRounds](src/data/phonicsRounds.test.jsx)) are a different kind again:
  they sweep every element and every exemplar word for the failures that do not
  throw — a duplicated key, an item with two right answers, a dangling
  confusable. Most other pages and
  games in `src/` still have no focused coverage.
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

- **Both public environments run on Google Cloud Run since 2026-09-17, and
  [deploy/gcp/README.md](deploy/gcp/README.md) owns that contract** — build,
  release, revision rollback, and the verification curls. Don't restate its
  project, service, or hostname details here.
- **The Linux released-artifact pipeline is gone.** `sondapor` and `camelot`
  were decommissioned on 2026-09-21 and `provision.sh`, `release.sh`,
  `rollback.sh`, `verify.sh`, the nginx templates, the pm2 ecosystem file and
  `deploy/targets/` were deleted with them. There is no box to ssh to and no
  nginx in the serving path; [docs/NGINX.md](docs/NGINX.md) is kept as history
  only, for the constraints that outlived the box. If you
  find a doc or comment describing releases, `current` symlinks, pm2 or nginx as
  current, it is stale — fix it. `git log` has the pipeline if it is ever wanted
  back.
- **[deploy/](deploy/README.md) is now database tooling only** — `db-push.sh`,
  `db-harden.sh`, `admin-account.sh`. They run locally from a checkout against
  the environment's Supabase database, take `-e test|prod` plus a mode-600
  `--env-file` holding `DATABASE_URL`, and read their non-secret facts from
  `deploy/environments/`. **Never** hand-type a `DATABASE_URL`; every
  environment difference is a file in `deploy/environments/`.
- **Production refuses to be touched by accident.** Every deploy script dies on a
  target with `DM_ENVIRONMENT=production` unless `DM_I_MEAN_PRODUCTION=1` is in
  the environment ([deploy/lib/common.sh](deploy/lib/common.sh)). Keep it: it is
  the difference between a typo'd `-t` and a change to the live site.
- **`ENABLE_CRON=0` is load-bearing and was once a no-op.** The flag is parsed as
  a boolean in [server/lib/cronSchedule.js](server/lib/cronSchedule.js) because
  `'0'` is a truthy string, so the old bare `!process.env.ENABLE_CRON` check armed
  the weekly digest on any box that set it to 0. An explicit off beats
  `NODE_ENV=production`. It relied on only pm2 cluster instance 0 scheduling;
  on Cloud Run the equivalent is production's single always-on instance, which
  is why `deploy/gcp/README.md` pins min and max instances to 1 with CPU always
  allocated. Keep both properties: the digest emails real parents and the orphan
  sweep deletes rows.
- **The drain handler is what makes a revision swap lossless.** The
  SIGINT/SIGTERM drain at the bottom of [server/index.js](server/index.js) is
  why in-flight requests survive an instance going away — it mattered for pm2
  cluster reloads and it matters for a Cloud Run revision cutover. If you add
  long-lived connections, close them in that handler or `server.close()` will
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
  push non-destructive — check RLS too. **A new table must end with
  `.enableRLS()`**: Supabase turns RLS on for tables created in `public`, so an
  undeclared one is stripped by the *next* push, and the environments don't even
  agree in the meantime (2026-08-03: both new tables came up RLS-on in production
  and RLS-off in test). The rule and its history are at the top of
  [server/db/schema.js](server/db/schema.js).
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
