# Database Migration — SQLite → Supabase (Postgres)

Migration of Dragon Math's local SQLite database to a managed Supabase Postgres
instance.

## Goals

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

## Schema inventory

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

| SQLite | Postgres (Drizzle) | Notes |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `serial PRIMARY KEY` | Original IDs preserved during migration; sequences bumped via `setval()`. |
| `INTEGER` (0/1 booleans) | `boolean` | e.g. `email_verified`, `weekly_report_enabled`, `dragon_trial_completed`, `completed`. |
| `TEXT DEFAULT datetime('now')` | `timestamptz DEFAULT now()` | All timestamp columns. |
| `TEXT COLLATE NOCASE` (usernames) | `citext` | Requires `CREATE EXTENSION citext`. |
| `TEXT` (JSON, e.g. `node_config.ops`) | `text` | Keep as text; `JSON.parse` in app code. Avoids touching query sites. |
| `TEXT CHECK (... IN (...))` | `text` + Drizzle check constraint | e.g. `outcome IN ('child', 'ai', 'incomplete')`. |

## Phased plan

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

10. Drop `better-sqlite3` from `package.json`.
11. Archive or remove `scripts/migrate-sqlite-to-postgres.js`.
12. Remove `dragon-math.db*` from working tree (keep a local backup outside the repo).
13. Update CLAUDE.md if any DB-touching guidance needs to change.
14. Merge `migrate-to-supabase` → `main`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Session pooler breaks Drizzle's prepared statements | Session pooler supports them (only transaction pooler doesn't). Fallback: disable prepared statements in `pg` config. |
| Data-loss during cutover if anyone is using the app | Cutover happens on the dev machine; no production users yet. Final migration run is right before the merge. |
| Timestamp conversion errors (TEXT → timestamptz) | Migration script parses with `new Date(text + 'Z')` (SQLite stores UTC); spot-check post-migration. |
| Foreign-key violations during load | Insert in dependency order; `TRUNCATE ... CASCADE` resets cleanly between runs. |
| `node_config.ops` JSON drift if migrated as `jsonb` | Keep as `text`; app already does `JSON.parse`/`JSON.stringify`. |
| Sequence collisions on next insert | `setval(pg_get_serial_sequence(...), max(id))` after each table load. |

## Open items deferred until after migration

- Whether to move `node_config.ops` to `jsonb` (post-migration follow-up).
- Whether to enable Row Level Security on Supabase (not required while we're using a server-side `pg` pool with the pooler URL).
- Whether to back up Supabase to a local snapshot on a schedule.
