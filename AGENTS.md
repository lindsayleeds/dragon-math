# Dragon Math — Project Notes

## Theme & content preferences

- **No dark/spiritual/occult themes.** Avoid witches, wizards, ghouls, zombies, demons, necromancy, séances, hexes, curses, dark magic, or any occult/spiritual-dark imagery in node names, icons, copy, art, or game content.
- Keep the world wholesome and nature-forward: animals, plants, weather, gems, cozy dwellings, friendly creatures, mythical-but-bright themes (dragons in the boss role are fine).
- When generating new map nodes, enemies, items, or flavor text, choose names/icons that fit this tone without being asked.

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
- **Entrypoint:** every server file imports `{ db, schema }` from
  [server/db.js](server/db.js). `db.execute(sql\`...\`)` is the escape hatch
  for raw queries when the Drizzle builder would be noisier than helpful
  (e.g. the aggregate-heavy queries in `server/lib/analytics.js`).
- **Usernames are `citext`** — `WHERE username = ?` and `ORDER BY username` are
  case-insensitive by default. Don't add `lower()` or COLLATE clauses.
- **`play_minutes.minute` stays as `text 'YYYY-MM-DD HH:MM'` in the server's
  local TZ.** Postgres has no `localtime` modifier, so the helper functions in
  [server/routes/playtime.js](server/routes/playtime.js) compute the
  comparison strings in JS; analytics/admin/parent all import them.
- **AVG() casts to `::float8`.** Without the cast, Postgres returns `numeric`
  which `pg` deserializes as a string, breaking the JSON shape the frontend
  expects.
- **No SQLite anywhere.** `better-sqlite3` was dropped in the Phase 4 cleanup.
  [scripts/migrate-sqlite-to-postgres.cjs](scripts/migrate-sqlite-to-postgres.cjs)
  is kept as historical/recovery documentation but is not runnable as-is.


## Tests

- **`npm test` (vitest) covers `server/**` only** — see
  [vitest.config.js](vitest.config.js). There are no frontend/UI tests yet, so
  don't assume a change is covered because the suite is green.
- **Server code is CommonJS, so `vi.mock()` does not intercept it.** `vi.mock`
  can't reach the `require()` calls inside a CJS module here; wire fakes the
  plain Node way instead — patch `Module._load` for bare deps and replace methods
  on the object `require('../db')` returns (it's the same reference the route
  destructured). Worked example:
  [server/routes/billing.portal.test.js](server/routes/billing.portal.test.js).
- Prefer keeping decision logic in a **pure** `server/lib/*.js` module so it can
  be tested without mocking db/Stripe at all (e.g.
  [server/lib/stripeCustomers.js](server/lib/stripeCustomers.js)).
- `npm run lint` has a large pre-existing error count (server files are linted
  with browser globals, so `require`/`module`/`process` all report `no-undef`).
  Compare against the baseline rather than expecting zero.


## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
