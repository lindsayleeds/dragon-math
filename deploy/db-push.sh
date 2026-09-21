#!/usr/bin/env bash
#
# Push server/db/schema.js to an environment's database with drizzle-kit.
#
# THE POINT OF THIS SCRIPT IS THE GUARD.
#
# `drizzle-kit push` diffs the schema definition against the live database and
# drops whatever it considers surplus. Aimed at production it is a data-loss
# event, and the repo has no committed migrations, so pushing is the only way to
# create a schema — which means someone will run this with the wrong
# DATABASE_URL in their shell sooner or later.
#
# So the check is an ALLOW-list, enforced here rather than left to the operator:
# the connection string must name the Supabase project ref recorded in
# deploy/environments/<name>.env (DM_EXPECTED_DB_REF). Anything else aborts
# before drizzle-kit is invoked. A deny-list of "not production" would fail open
# against a typo or a new project; an allow-list fails closed.
#
# The guard checks the URL drizzle-kit will ACTUALLY resolve. That used to take
# care, because drizzle.config.cjs calls dotenv, which keeps the LAST duplicate
# assignment in a file and does NOT override a value already in the environment
# — so a grep of the file was not the same value. This script removes the
# ambiguity instead of reasoning about it: it exports DATABASE_URL from
# --env-file, which by that same dotenv rule beats the repo's own .env, and
# refuses an env file that assigns DATABASE_URL more than once.
#
# Usage:
#   deploy/db-push.sh -e test --env-file /path/to/db.env [--force] [--dry-run]
#
#   --env-file F   file assigning DATABASE_URL, mode 600 (see deploy/README.md)
#   --dry-run      run every guard, then stop without touching the database
#   --force        pass drizzle-kit's --force (skips its interactive prompts).
#                  Only meaningful on an empty or throwaway database.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ENVIRONMENT=""; FORCE=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -e|-t|--environment|--target) ENVIRONMENT="${2:?}"; shift 2 ;;
    --env-file)   DM_ENV_FILE="${2:?}"; shift 2 ;;
    --force)      FORCE=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    sed -n '2,33p' "$0"; exit 0 ;;
    *)            die "unknown argument '$1'" ;;
  esac
done
[ -n "$ENVIRONMENT" ] || die "usage: $0 -e <environment> --env-file <file> [--force] [--dry-run]"

load_environment "$ENVIRONMENT"
require_env_file

cd "$DM_REPO_DIR"
[ -f server/db/schema.js ]   || die "no server/db/schema.js in $DM_REPO_DIR"
[ -f drizzle.config.cjs ]    || die "no drizzle.config.cjs in $DM_REPO_DIR"
[ -d node_modules/drizzle-kit ] || die "drizzle-kit is not installed — run npm ci first"

say "schema push to '$ENVIRONMENT' (expected project: $DM_EXPECTED_DB_REF)"

# The push applies whatever is in the WORKING TREE. On the retired box it
# applied a built release, which could not contain uncommitted edits. Assert the
# equivalent here so the schema that lands is one that exists in git.
if ! git diff --quiet HEAD -- server/db/schema.js; then
  die "server/db/schema.js has uncommitted changes — commit or stash before pushing a schema"
fi
say "     schema      server/db/schema.js ($(wc -l < server/db/schema.js) lines) @ $(git rev-parse --short HEAD)"
node -e '
const fs = require("fs");
const v = p => { try { return JSON.parse(fs.readFileSync("node_modules/" + p + "/package.json", "utf8")).version; }
                 catch { return "?"; } };
console.log("     drizzle-kit " + v("drizzle-kit") + " | drizzle-orm " + v("drizzle-orm"));
'

# ── the guard ────────────────────────────────────────────────────────────────
# Nothing that can touch the database happens before this.
say "checking which database drizzle-kit will resolve"
assert_database
ok "guard passed"

# Everything below runs with DATABASE_URL taken from the env file. dotenv does
# not override an already-set variable, so this value — the guarded one — is
# what drizzle.config.cjs and the node snippets below see, not the repo's .env.
DATABASE_URL="$(DM_ENV_FILE="$DM_ENV_FILE" node -e '
  const fs = require("fs"), dotenv = require("dotenv");
  process.stdout.write(dotenv.parse(fs.readFileSync(process.env.DM_ENV_FILE, "utf8")).DATABASE_URL);
')"
export DATABASE_URL

if [ "$DRY" = "1" ]; then
  warn "--dry-run: guards passed, stopping before drizzle-kit"
  exit 0
fi

# ── citext ───────────────────────────────────────────────────────────────────
# drizzle-kit does not create extensions, and server/db/schema.js declares
# usernames as citext, so the extension has to exist before the push or every
# citext column fails with "type citext does not exist".
say "ensuring the citext extension exists"
# shellcheck disable=SC2016
node -e '
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("CREATE EXTENSION IF NOT EXISTS citext");
  const r = await c.query("select extname from pg_extension where extname = $1", ["citext"]);
  console.log("     citext installed:", r.rowCount === 1);
  await c.end();
})().catch(e => { console.error("citext setup failed:", e.message); process.exit(1); });
'
ok "citext ready"

# ── push ─────────────────────────────────────────────────────────────────────
say "running drizzle-kit push"
FORCE_FLAG=""; if [ "$FORCE" = "1" ]; then FORCE_FLAG="--force"; fi
# FORCE_FLAG is either empty or exactly --force, so word splitting is wanted.
# shellcheck disable=SC2086
./node_modules/.bin/drizzle-kit push --config=drizzle.config.cjs $FORCE_FLAG
ok "push complete"

# ── report ───────────────────────────────────────────────────────────────────
say "resulting schema"
# shellcheck disable=SC2016
node -e '
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const t = await c.query(
    "select table_name from information_schema.tables where table_schema = $1 and table_type = $2 order by 1",
    ["public", "BASE TABLE"]);
  console.log("     tables (" + t.rowCount + "): " + t.rows.map(r => r.table_name).join(", "));
  const u = await c.query(
    "select data_type, udt_name from information_schema.columns where table_name = $1 and column_name = $2",
    ["users", "username"]);
  if (u.rowCount) console.log("     users.username type: " + u.rows[0].udt_name);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
'
ok "schema push done for '$ENVIRONMENT'"
