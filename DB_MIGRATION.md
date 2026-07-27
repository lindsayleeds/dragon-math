# Database Migration — SQLite → Supabase (Postgres) — COMPLETED, HISTORICAL

> **This is a historical record of a finished migration, not a description of
> the current system, and not work that is still pending.**
>
> The cutover happened; Dragon Math runs on Supabase-hosted Postgres via
> `drizzle-orm` + `pg`, and **there is no SQLite anywhere in the project** —
> `better-sqlite3` is gone from `package.json` and no code path touches a
> `.db` file. Every plan, decision, and phase below is written in the
> future/imperative tense of when it was authored; read it all as past tense.
>
> For the **current** schema, read [server/db/schema.js](server/db/schema.js),
> which is the source of truth (there is no committed Drizzle migration
> directory — that file plus `drizzle-kit push` *is* the mechanism). For
> current DB guidance, see the **Database** section of
> [AGENTS.md](AGENTS.md).
>
> This document is kept because it is the only record of *why* the schema looks
> the way it does — the type-translation choices below explain decisions the
> live schema still embodies.

## Goals (as of the cutover)

- Move from `better-sqlite3` + local `dragon-math.db` to Supabase Postgres.
- Adopt **Drizzle ORM** for query construction and schema management.
- Preserve all existing data (20 users, ~115 matches, ~555 problem attempts, etc.).
- One-shot cutover on a feature branch — no dual-write window.

## Decisions (locked in)

| Decision | Choice | Reasoning |
|---|---|---|
| ORM | **Drizzle** | Lighter than Prisma, SQL-first, no separate query engine, lower-churn port from raw SQL. |
| Data handling | **Migrate all rows** | Preserve user accounts, progress, history, trial results. |
| Env vars | **`.env` file** | Loaded via `dotenv`; `.env` already gitignored. |
| Connection | **Session pooler** (`aws-1-us-west-1.pooler.supabase.com:5432`) | Azure VM is IPv4-only; session pooler supports prepared statements (transaction pooler doesn't). |
| Username case-insensitivity | **`citext` extension** | Cleanest replacement for SQLite's `COLLATE NOCASE` — no `lower()` boilerplate at call sites. |
| Cutover | **Big bang on a branch** | Single branch, swap everything, merge when verified. No env-flag fallback. |
| Migration script | **Wipe + reseed each run** | Lets us iterate. Final run = the cutover. |

## Schema inventory (snapshot taken before the cutover — long since outgrown)

Row counts and table list below are the migration's *scope at the time*, not the
current schema. Tables have been added since; read
[server/db/schema.js](server/db/schema.js) for what exists today.

13 tables; ~98 DB call sites across 13 server files.

| Table | Rows | Notes |
|---|---:|---|
| `users` | 20 | accounts (parent + child), auth, dragon_trial flag |
| `node_progress` | 116 | per-user node completion |
| `node_config` | 41 | admin-editable battle config |
| `matches` | 115 | battle history |
| `problem_attempts` | 555 | per-problem analytics |
| `wrong_taps` | 45 | wrong-tap analytics |
| `user_companions` | 27 | unlocked companions |
| `play_minutes` | 116 | playtime tracking |
| `parent_child_links` | 3 | parent ↔ child relationship |
| `parent_claim_codes` | 2 | parent claim flow |
| `weekly_report_log` | 2 | weekly email job log |
| `dragon_trial_results` | 1 | placement test result |

### Type translations (SQLite → Postgres)

The mapping that was applied during the cutover. Several of these choices are
why the live schema looks as it does (`citext` usernames, JSON-as-`text`,
date-ish columns as `text`) — the columns themselves are defined in
[server/db/schema.js](server/db/schema.js).

| SQLite (former) | Postgres (Drizzle) | Notes |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `serial PRIMARY KEY` | Original IDs preserved during migration; sequences bumped via `setval()`. |
| `INTEGER` (0/1 booleans) | `boolean` | e.g. `email_verified`, `weekly_report_enabled`, `dragon_trial_completed`, `completed`. |
| `TEXT DEFAULT datetime('now')` | `timestamptz DEFAULT now()` | All timestamp columns. |
| `TEXT COLLATE NOCASE` (usernames) | `citext` | Requires `CREATE EXTENSION citext`. |
| `TEXT` (JSON, e.g. `node_config.ops`) | `text` | Keep as text; `JSON.parse` in app code. Avoids touching query sites. |
| `TEXT CHECK (... IN (...))` | `text` + Drizzle check constraint | e.g. `outcome IN ('child', 'ai', 'incomplete')`. |

## Phased plan (all phases completed; nothing here is outstanding)

### Phase 1 — Setup & schema (no behavior change)

1. Cut branch `migrate-to-supabase`.
2. Install deps: `drizzle-orm`, `drizzle-kit`, `pg`. Keep `better-sqlite3` temporarily (needed by the migration script).
3. Add `DATABASE_URL` to `.env` (real) and `.env.example` (template).
4. Create `server/db/schema.js` — Drizzle pg schema mirroring SQLite tables.
5. Replace `server/db.js` with a Drizzle entrypoint exporting `{ db, pool, schema }`. Old schema-bootstrap block goes away (Drizzle migrations own schema now).
6. Configure `drizzle.config.js` and run `drizzle-kit push` against Supabase to create tables + indexes + `citext` extension.
7. Smoke test: `SELECT 1` from app code.

**Stop point:** show user the live schema before going further.

### Phase 2 — Data migration script

8. Write `scripts/migrate-sqlite-to-postgres.js`:
   - Reads `dragon-math.db` via `better-sqlite3`.
   - Writes to Supabase via the `pg` pool.
   - **Wipes** all target tables first (`TRUNCATE ... RESTART IDENTITY CASCADE`).
   - Inserts in FK order: `users` → child tables → analytics tables.
   - **Preserves original IDs** so existing foreign-key references stay intact.
   - Bumps sequences with `SELECT setval(...)` after load.
   - Converts SQLite TEXT timestamps to JS `Date` for `timestamptz` columns.
   - Idempotent — safe to re-run.
9. Run it. Verify row counts and a few spot checks (a known username can log in shape-wise; `node_config` matches; etc.).

### Phase 3 — Refactor server code (~98 call sites)

Rewrite `db.prepare(...).run/get/all` → Drizzle queries. Done in route-file
chunks so each step is reviewable:

| File | Call sites |
|---|---:|
| `server/routes/admin.js` | 23 |
| `server/routes/auth.js` | 14 |
| `server/lib/analytics.js` | 12 |
| `server/routes/parent.js` | 11 |
| `server/routes/companions.js` | 8 |
| `server/routes/dragonTrial.js` | 7 |
| `server/lib/weeklyReport.js` | 6 |
| `server/routes/progress.js` | 5 |
| `server/routes/matches.js` | 3 |
| `server/routes/attempts.js` | 3 |
| `server/routes/playtime.js` | 3 |
| `server/routes/childCode.js` | 2 |
| `server/routes/nodeConfig.js` | 1 |

Verify each route in dev after its chunk lands.

### Phase 4 — Cleanup

10. Drop `better-sqlite3` from `package.json`. — done; it is not a dependency.
11. Archive or remove `scripts/migrate-sqlite-to-postgres.js`. — archived in
    tree as [scripts/migrate-sqlite-to-postgres.cjs](scripts/migrate-sqlite-to-postgres.cjs),
    documentation only. It, `scripts/migrate-insert-honey-world.cjs`, and
    `scripts/retune-difficulty.cjs` all `require('better-sqlite3')` and so
    cannot run as-is; each carries a HISTORICAL header saying so.
12. Remove `dragon-math.db*` from working tree (keep a local backup outside the repo). — done.
13. Update CLAUDE.md if any DB-touching guidance needs to change. — done; see
    the **Database** section of [AGENTS.md](AGENTS.md) (`CLAUDE.md` symlinks to it).
14. Merge `migrate-to-supabase` → `main`. — done.

## Risks & mitigations (as assessed before the cutover)

| Risk | Mitigation |
|---|---|
| Session pooler breaks Drizzle's prepared statements | Session pooler supports them (only transaction pooler doesn't). Fallback: disable prepared statements in `pg` config. |
| Data-loss during cutover if anyone is using the app | Cutover happens on the dev machine; no production users yet. Final migration run is right before the merge. |
| Timestamp conversion errors (TEXT → timestamptz) | Migration script parses with `new Date(text + 'Z')` (SQLite stores UTC); spot-check post-migration. |
| Foreign-key violations during load | Insert in dependency order; `TRUNCATE ... CASCADE` resets cleanly between runs. |
| `node_config.ops` JSON drift if migrated as `jsonb` | Keep as `text`; app already does `JSON.parse`/`JSON.stringify`. |
| Sequence collisions on next insert | `setval(pg_get_serial_sequence(...), max(id))` after each table load. |

## Open items deferred until after migration

Recorded here as they stood at the cutover; this list is not tracked. Live
follow-ups belong in [docs/TODO.md](docs/TODO.md).

- Whether to move `node_config.ops` to `jsonb` (post-migration follow-up).
- Whether to enable Row Level Security on Supabase (not required while we're using a server-side `pg` pool with the pooler URL).
- Whether to back up Supabase to a local snapshot on a schedule.
