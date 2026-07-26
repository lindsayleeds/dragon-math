#!/usr/bin/env bash
#
# Push server/db/schema.js to a target's database with drizzle-kit.
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
# deploy/targets/<target>.env (DM_EXPECTED_DB_REF). Anything else aborts before
# drizzle-kit is invoked. A deny-list of "not production" would fail open
# against a typo or a new project; an allow-list fails closed.
#
# The push runs ON the target box against the target's own shared/.env, so a
# workstation's ambient DATABASE_URL cannot leak into it at all.
#
# Usage:
#   deploy/db-push.sh -t test [--release SHA] [--force] [--dry-run]
#
#   --release SHA  use that release's tree (default: whatever `current` is)
#   --dry-run      run every guard and print the plan, then stop
#   --force        pass drizzle-kit's --force (skips its interactive prompts).
#                  Only meaningful on an empty or throwaway database.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; RELEASE=""; FORCE=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)  TARGET="${2:?}"; shift 2 ;;
    --release)    RELEASE="${2:?}"; shift 2 ;;
    --force)      FORCE=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *)            die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--release SHA] [--force] [--dry-run]"
load_target "$TARGET"

: "${DM_EXPECTED_DB_REF:?target '$TARGET' must define DM_EXPECTED_DB_REF — refusing to push to an unspecified database}"
require_ssh

say "schema push to target '$TARGET' (expected project: $DM_EXPECTED_DB_REF)"

# ── the guard ────────────────────────────────────────────────────────────────
# Everything here runs on the box, reads only shared/.env, and prints no secret.
say "checking which database shared/.env points at"
rbash <<REMOTE
expected=$(qq "$DM_EXPECTED_DB_REF")

url="\$(grep -m1 '^DATABASE_URL=' "\$DM_SHARED/.env" | cut -d= -f2-)"
[ -n "\$url" ] || { echo "DATABASE_URL is not set in \$DM_SHARED/.env" >&2; exit 1; }

# Supabase pooler usernames are 'postgres.<project_ref>'.
user="\$(printf '%s' "\$url" | sed -E 's|^postgresql://([^:]+):.*|\1|')"
host="\$(printf '%s' "\$url" | sed -E 's|.*@([^:/]+).*|\1|')"
ref="\${user#postgres.}"

echo "     db user     \$user"
echo "     db host     \$host"
echo "     project ref \$ref"
echo "     expected    \$expected"

if [ "\$ref" != "\$expected" ]; then
  cat >&2 <<MSG

REFUSING TO PUSH.

  DATABASE_URL names project '\$ref'
  but target '$TARGET' allows only  '\$expected'

drizzle-kit push drops objects it thinks are surplus. Fix shared/.env, or fix
DM_EXPECTED_DB_REF in deploy/targets/$TARGET.env if the target really moved.
MSG
  exit 1
fi
echo "     guard OK — project ref matches the allow-list"
REMOTE
ok "guard passed"

# ── locate the tree to push from ─────────────────────────────────────────────
TREE="$DM_CURRENT"
[ -n "$RELEASE" ] && TREE="$DM_RELEASES/$RELEASE"

rbash <<REMOTE
tree=$(qq "$TREE")
[ -f "\$tree/server/db/schema.js" ] || { echo "no server/db/schema.js under \$tree — deploy a release first" >&2; exit 1; }
[ -f "\$tree/drizzle.config.cjs" ]  || { echo "no drizzle.config.cjs under \$tree" >&2; exit 1; }
echo "     schema      \$tree/server/db/schema.js ($(wc -l < "\$tree/server/db/schema.js") lines)"
REMOTE

if [ "$DRY" = "1" ]; then
  warn "--dry-run: guards passed, stopping before drizzle-kit"
  exit 0
fi

# ── citext ───────────────────────────────────────────────────────────────────
# drizzle-kit does not create extensions, and server/db/schema.js declares
# usernames as citext, so the extension has to exist before the push or every
# citext column fails with "type citext does not exist".
say "ensuring the citext extension exists"
rbash <<REMOTE
cd $(qq "$TREE")
node -e '
require("dotenv").config();
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
REMOTE
ok "citext ready"

# ── push ─────────────────────────────────────────────────────────────────────
say "running drizzle-kit push"
FORCE_FLAG=""; [ "$FORCE" = "1" ] && FORCE_FLAG="--force"
rbash <<REMOTE
cd $(qq "$TREE")
# drizzle-kit is a dev dependency and releases are pruned to production deps, so
# fetch it on demand rather than fattening every release with it. The version is
# pinned to the one in this release's package.json.
ver="\$(node -e 'console.log(require("./package.json").devDependencies["drizzle-kit"])')"
echo "     drizzle-kit \$ver"
npx --yes "drizzle-kit@\$ver" push --config=drizzle.config.cjs $(qq "$FORCE_FLAG")
REMOTE
ok "push complete"

# ── report ───────────────────────────────────────────────────────────────────
say "resulting schema"
rbash <<REMOTE
cd $(qq "$TREE")
node -e '
require("dotenv").config();
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
REMOTE
ok "schema push done for target '$TARGET'"
