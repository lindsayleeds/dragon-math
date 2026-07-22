---
name: supabase
description: >-
  Query and manage Dragon Math's Supabase Postgres database (Drizzle ORM + pg).
  Use this whenever a task involves the app's data or database — answering
  questions about users, kids, parents, plans, playtime, dragons, matches, or
  any analytics ("how many users do I have?", "how many premium subscribers?",
  "which nodes get the most wrong answers?"), running SQL or one-off queries,
  inspecting or changing the schema, adding a column or table, or running a
  Drizzle migration. Trigger it even when the user doesn't say "Supabase" or
  "database" but is clearly asking about the app's stored data. It captures the
  connection options, the project's DB conventions (citext usernames, agent
  test accounts, local-TZ play_minutes, float8 AVG casts), the table catalog,
  ready-made queries, and the safe migration workflow.
---

# Supabase — Dragon Math's database

Dragon Math stores everything in a **Supabase Postgres** database, accessed
through **Drizzle ORM** over the `pg` driver. This skill is the fast path for
two kinds of work: **answering data questions against the live DB**, and
**changing the schema safely**.

The schema is the source of truth in
[server/db/schema.js](../../../server/db/schema.js); every server file imports
`{ db, pool, schema }` from [server/db.js](../../../server/db.js). Read those
two files when you need ground truth — this skill summarizes them but they win
if they ever disagree.

## First: how will you reach the database?

There are two connection paths. Figure out which is available before writing a
query, because it changes *how* you run it.

1. **Supabase MCP connector** — if the session has authorized `supabase` MCP
   tools (search for them with ToolSearch, query `+supabase`), use those to run
   SQL directly. This is the cleanest path and needs no local secrets. If the
   tools aren't there, the connector isn't authorized; tell the user they can
   authorize it in their claude.ai connector settings (or `/mcp` in an
   interactive session) — don't ask them for tokens or callback URLs.

2. **Direct connection via `DATABASE_URL`** — if `.env` has a real
   `DATABASE_URL` (or it's exported in the environment), you can run SQL from
   Node using the project's own `pg` pool. Use the bundled helper:

   ```bash
   node .claude/skills/supabase/scripts/query.cjs "SELECT count(*) FROM users"
   ```

   `scripts/query.cjs` is **read-only by design** — it refuses anything that
   isn't a single `SELECT`/`WITH` statement, so it's safe to run against
   production for questions. It prints rows as JSON. For writes or migrations,
   use the Drizzle workflow below, never this helper.

If **neither** path is available (no MCP tools, only `.env.example` with a
placeholder `DATABASE_URL`), you cannot get a live number. Say so plainly,
show the query you *would* run, and offer both fixes — don't guess a count.

The connection string is the Supabase **Session pooler** (port 5432, supports
prepared statements — Drizzle's `pg` driver requires that; the Transaction
pooler on 6543 does not). See `DATABASE_URL` in
[.env.example](../../../.env.example).

## Conventions that will bite you if you forget them

These are non-obvious and each one has burned someone before. They come from
the project's CLAUDE.md and the code itself.

- **Usernames are `citext`.** `WHERE username = 'Alice'` and `ORDER BY username`
  are already case-insensitive. Do **not** wrap them in `lower()` or add
  `COLLATE` — it defeats the index and is redundant.

- **`created_by_agent` marks throwaway test accounts.** Parent/child rows
  created by an automated agent (e.g. Claude during testing) have
  `created_by_agent = true`. Real signups are always `false`. For any count or
  analytic that should reflect *real* usage, filter them out:
  `WHERE NOT created_by_agent`. Mention when you've excluded them so the number
  isn't a surprise.

- **`users` holds both adults and kids.** `account_type` is `'child'` for kids;
  adults carry an `adult_role` (`'parent'` by default, also `'teacher'`). A bare
  `count(*)` mixes guardians and students — usually you want a breakdown by
  `account_type`. Kids don't hold a `plan`; their access is derived from their
  guardian(s) (see `server/lib/entitlements.js`).

- **Billing lives on the adult `users` row.** `plan` is `'free' | 'premium' |
  'classroom'`; `plan_status` is `'active' | 'trialing' | 'past_due' |
  'canceled' | NULL`. Stripe is the source of truth — those columns are a
  write-through cache. "Paying customers" ≈ `plan != 'free' AND plan_status IN
  ('active','trialing')`.

- **`play_minutes.minute` is `text 'YYYY-MM-DD HH:MM'` in the server's local
  timezone**, not a timestamp. Postgres has no `localtime` modifier, so the
  comparison strings are computed in JS by the helpers in
  [server/routes/playtime.js](../../../server/routes/playtime.js) —
  `localMinuteNow()`, `localDayString()`, `toLocalIsoDay()`, `buildDaySeries()`.
  Analytics, admin, and parent routes all import them. Reuse those helpers
  instead of hand-rolling date math, or your day boundaries will drift by the
  UTC offset.

- **Cast `AVG()` to `::float8`.** Un-cast, Postgres returns `numeric`, which
  `pg` deserializes as a *string*, breaking the JSON shape the frontend expects.
  This is why the aggregate-heavy queries in
  [server/lib/analytics.js](../../../server/lib/analytics.js) use
  `db.execute(sql\`...\`)` with explicit `::float8` casts rather than the
  Drizzle query builder.

- **No SQLite, anywhere.** `better-sqlite3` was removed in the Phase 4 cleanup.
  `scripts/migrate-sqlite-to-postgres.cjs` is kept only as historical/recovery
  documentation and is not runnable as-is. Ignore it for new work.

## Querying the live database

For simple reads, prefer the Drizzle query builder or the MCP connector. For
aggregate-heavy work, raw SQL via `db.execute(sql\`...\`)` is the sanctioned
escape hatch (that's what analytics.js does) — clearer than a tortured builder
expression. When counting real users or usage, remember the
`created_by_agent` filter.

Ready-made queries for the most common questions:

```sql
-- Total accounts (adults + kids, including agent test rows)
SELECT count(*) FROM users;

-- Real accounts only, split by kind
SELECT account_type, count(*)
FROM users
WHERE NOT created_by_agent
GROUP BY account_type;

-- Real adults by role (parents vs teachers)
SELECT adult_role, count(*)
FROM users
WHERE account_type <> 'child' AND NOT created_by_agent
GROUP BY adult_role;

-- Paying customers, by plan
SELECT plan, count(*)
FROM users
WHERE plan <> 'free'
  AND plan_status IN ('active', 'trialing')
  AND NOT created_by_agent
GROUP BY plan;

-- New real signups in the last 30 days
SELECT count(*)
FROM users
WHERE NOT created_by_agent
  AND created_at >= now() - interval '30 days';
```

## Table catalog

Full definitions and column comments live in
[server/db/schema.js](../../../server/db/schema.js) — read it before touching a
table. Quick map of what's where:

| Table | What it holds |
|-------|---------------|
| `users` | Every account: adults (parent/teacher) and kids. Auth, avatar, plan/Stripe billing, `created_by_agent`, `login_token`. |
| `node_progress` | Per-kid progress through story-map nodes. |
| `node_config` | Static configuration for map nodes. |
| `problem_attempts` | One row per math problem attempted (correctness, timing). |
| `wrong_taps` | Mis-taps within a problem — feeds "which nodes are hardest". |
| `user_companions` | Companion creatures a kid has. |
| `play_minutes` | Playtime, one row per minute-of-play; `minute` is local-TZ text (see conventions). |
| `matches` | Head-to-head / versus game records. |
| `parent_child_links` | Guardian → child relationships. |
| `classrooms` / `classroom_members` | Teacher-owned classrooms and their kids. |
| `tribes` / `tribe_members` | Friend/group groupings. |
| `parent_claim_codes` | Codes a parent uses to claim/link a child account. |
| `weekly_report_log` | Sent-history for the weekly parent digest. |
| `dragon_trial_results` | Results of the dragon trial mini-assessment. |
| `dragon_catalog` | Static dragon definitions (art id, rarity). |
| `user_dragons` | Which dragons a kid has collected, with dup `count`. |
| `game_scores` | Arcade mini-game runs; drives leaderboards, keyed by `game`. |

## Changing the schema (migrations)

The schema is **code-first**: edit [server/db/schema.js](../../../server/db/schema.js),
then let Drizzle Kit reconcile the database to match it.

1. Edit `server/db/schema.js` — add/alter the `pgTable`, add indexes, and
   **add it to the `module.exports` block** at the bottom (a table that isn't
   exported won't be seen by callers). Match the surrounding style: descriptive
   column comments explaining *why*, `withTimezone: true` timestamps,
   `references(() => users.id, { onDelete: 'cascade' })` for kid-owned rows.

2. Push to Supabase:

   ```bash
   npx drizzle-kit push --config=drizzle.config.cjs
   ```

   `push` diffs the schema against the live DB and applies the change directly —
   good for the single-developer Supabase setup here. It's driven by
   [drizzle.config.cjs](../../../drizzle.config.cjs), which points at
   `DATABASE_URL`, so you need a working connection for this step.

3. Because `push` writes to the database, treat it like any outward-facing
   action: confirm with the user before running it against a shared/production
   database unless they've clearly asked you to apply it. `drizzle-kit`'s
   `generate` (to emit a SQL migration file under `server/db/migrations`) is the
   review-first alternative if they want to eyeball the DDL before it lands.

Notes: `citext` is an extension type; the config's `schemaFilter: ['public']`
and the schema's custom `citext` type keep Drizzle from emitting spurious
"type does not exist" warnings on push. Keep new case-insensitive text columns
consistent with that pattern rather than inventing a new one.
