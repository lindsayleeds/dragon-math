# Dragon Math — Project Notes

## Theme & content preferences

- **No dark/spiritual/occult themes.** Avoid witches, wizards, ghouls, zombies, demons, necromancy, séances, hexes, curses, dark magic, or any occult/spiritual-dark imagery in node names, icons, copy, art, or game content.
- Keep the world wholesome and nature-forward: animals, plants, weather, gems, cozy dwellings, friendly creatures, mythical-but-bright themes (dragons in the boss role are fine).
- When generating new map nodes, enemies, items, or flavor text, choose names/icons that fit this tone without being asked.

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

