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
# The guard checks the URL drizzle-kit will ACTUALLY resolve, not a grep of
# shared/.env, because those are not the same value: drizzle.config.cjs goes
# through dotenv, which keeps the LAST duplicate assignment in the file and does
# not override a value already present in the environment. So the guard resolves
# it with node+dotenv inside the workspace drizzle-kit runs in, and refuses
# outright if either ambiguity exists (duplicate lines, or an ambient
# DATABASE_URL that disagrees with the file).
#
# The push runs ON the target box against the target's own shared/.env, so a
# workstation's ambient DATABASE_URL cannot leak into it at all — but the BOX's
# own environment can, which is why that case is checked explicitly.
#
# Usage:
#   deploy/db-push.sh -t test [--release SHA] [--force] [--dry-run]
#
#   --release SHA  use that release's tree (default: whatever `current` is)
#   --dry-run      prepare the schema workspace, run every guard, then stop
#                  without touching the database
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
    -h|--help)    sed -n '2,38p' "$0"; exit 0 ;;
    *)            die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--release SHA] [--force] [--dry-run]"
load_target "$TARGET"

: "${DM_EXPECTED_DB_REF:?target '$TARGET' must define DM_EXPECTED_DB_REF — refusing to push to an unspecified database}"
require_ssh

say "schema push to target '$TARGET' (expected project: $DM_EXPECTED_DB_REF)"

# ── locate the tree to push from ─────────────────────────────────────────────
TREE="$DM_CURRENT"
if [ -n "$RELEASE" ]; then TREE="$DM_RELEASES/$RELEASE"; fi

rbash tree="$TREE" <<'REMOTE'
[ -f "$tree/server/db/schema.js" ] || { echo "no server/db/schema.js under $tree — deploy a release first" >&2; exit 1; }
[ -f "$tree/drizzle.config.cjs" ]  || { echo "no drizzle.config.cjs under $tree" >&2; exit 1; }
echo "     schema      $tree/server/db/schema.js ($(wc -l < "$tree/server/db/schema.js") lines)"
REMOTE

# ── isolated schema workspace ────────────────────────────────────────────────
# The push does NOT run inside a release. Releases are pruned to production
# dependencies, and drizzle-kit resolves drizzle-orm relative to itself, so
# `npx drizzle-kit` inside a release fails with "please install required
# packages: 'drizzle-orm'". Installing it into the release would work but would
# leave the release different from what was built, and immutable releases are
# the whole point of this layout.
#
# So the schema tooling gets its own directory, built from the release's own
# package.json + lockfile (same versions, no drift) and reused across runs while
# the lockfile is unchanged.
#
# This runs BEFORE the guard on purpose: `npm ci` into a scratch directory
# touches no database, and it is what lets the guard resolve DATABASE_URL with
# the same dotenv, from the same cwd, as drizzle-kit itself.
say "preparing the schema workspace"
rbash tree="$TREE" <<'REMOTE'
work="$DM_ROOT/schema-work"
mkdir -p "$work/server/db"
cp "$tree/package.json" "$tree/package-lock.json" "$tree/drizzle.config.cjs" "$work/"
cp "$tree/server/db/schema.js" "$work/server/db/schema.js"
# drizzle.config.cjs and the schema both read env from the cwd's .env.
ln -sfn "$DM_SHARED/.env" "$work/.env"

cd "$work"
if [ ! -d node_modules ] || ! cmp -s package-lock.json .lock-stamp; then
  echo "     installing schema tooling (lockfile changed or first run)"
  npm ci --no-audit --no-fund
  cp package-lock.json .lock-stamp
else
  echo "     reusing existing node_modules (lockfile unchanged)"
fi
# Read the manifests off disk: drizzle-kit does not expose ./package.json
# through its "exports" map, so require()-ing it throws.
node -e '
const fs = require("fs");
const v = p => { try { return JSON.parse(fs.readFileSync("node_modules/" + p + "/package.json", "utf8")).version; }
                 catch { return "?"; } };
console.log("     drizzle-kit " + v("drizzle-kit") + " | drizzle-orm " + v("drizzle-orm"));
'
REMOTE
ok "workspace ready"

# ── the guard ────────────────────────────────────────────────────────────────
# Runs on the box, reads only shared/.env plus the box's own environment, and
# prints no secret. Nothing that can touch the database happens before it.
say "checking which database drizzle-kit will resolve"
rbash expected="$DM_EXPECTED_DB_REF" target="$TARGET" <<'REMOTE'
cd "$DM_ROOT/schema-work"

# Resolved the way drizzle.config.cjs resolves it, from the directory drizzle-kit
# will run in. A grep of shared/.env is NOT the same value: dotenv keeps the last
# duplicate assignment, and leaves an existing environment variable alone.
facts="$(DM_ENV_FILE="$DM_SHARED/.env" node -e '
const fs = require("fs");
const dotenv = require("dotenv");
const raw = fs.readFileSync(process.env.DM_ENV_FILE, "utf8");

const assignments = raw.split(/\r?\n/)
  .filter(l => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l)).length;
const fromFile = dotenv.parse(raw).DATABASE_URL || "";
const ambient = process.env.DATABASE_URL || "";

dotenv.config();
const url = process.env.DATABASE_URL || "";

// Supabase pooler usernames are "postgres.<project_ref>". Only the identifying
// parts are printed; the password never leaves this process.
let user = "", host = "";
try {
  const u = new URL(url);
  user = decodeURIComponent(u.username);
  host = u.hostname;
} catch { /* left empty, refused below */ }

console.log("ASSIGNMENTS=" + assignments);
console.log("AMBIENT_CONFLICT=" + (ambient && ambient !== fromFile ? "yes" : "no"));
console.log("USER=" + user);
console.log("HOST=" + host);
')"

g() { printf '%s' "$facts" | grep -m1 "^$1=" | cut -d= -f2- || true; }

assignments="$(g ASSIGNMENTS)"
if [ "${assignments:-0}" -gt 1 ]; then
  cat >&2 <<MSG

REFUSING TO PUSH — ambiguous DATABASE_URL.

  $DM_SHARED/.env assigns DATABASE_URL $assignments times.

dotenv keeps the LAST assignment, so a reader of this file and drizzle-kit can
disagree about which database is meant. Leave exactly one DATABASE_URL line
(edit the existing one; do not append a correction) and re-run.
MSG
  exit 1
fi

if [ "$(g AMBIENT_CONFLICT)" = "yes" ]; then
  cat >&2 <<MSG

REFUSING TO PUSH — DATABASE_URL comes from the environment, not shared/.env.

  This box's shell environment already sets DATABASE_URL, and it differs from
  $DM_SHARED/.env.

dotenv does not override a value that is already set, so the ambient one is what
drizzle-kit would use — and it is not the one this target's guard describes.
Unset it on the box (check /etc/environment, which pam_env applies to ssh
sessions, and the deploy user's shell profile) and re-run.
MSG
  exit 1
fi

user="$(g USER)"
host="$(g HOST)"
ref="${user#postgres.}"

echo "     db user     ${user:-(none)}"
echo "     db host     ${host:-(none)}"
echo "     project ref ${ref:-(none)}"
echo "     expected    $expected"

if [ -z "$user" ]; then
  cat >&2 <<MSG

REFUSING TO PUSH.

  drizzle.config.cjs would resolve an empty or unparseable DATABASE_URL.

Set a postgresql:// connection string in $DM_SHARED/.env.
MSG
  exit 1
fi

if [ "$ref" != "$expected" ]; then
  cat >&2 <<MSG

REFUSING TO PUSH.

  DATABASE_URL names project '$ref'
  but target '$target' allows only  '$expected'

drizzle-kit push drops objects it thinks are surplus. Fix shared/.env, or fix
DM_EXPECTED_DB_REF in deploy/targets/$target.env if the target really moved.
MSG
  exit 1
fi
echo "     guard OK — project ref matches the allow-list"
REMOTE
ok "guard passed"

if [ "$DRY" = "1" ]; then
  warn "--dry-run: guards passed, stopping before drizzle-kit"
  exit 0
fi

# ── citext ───────────────────────────────────────────────────────────────────
# drizzle-kit does not create extensions, and server/db/schema.js declares
# usernames as citext, so the extension has to exist before the push or every
# citext column fails with "type citext does not exist".
say "ensuring the citext extension exists"
rbash <<'REMOTE'
cd "$DM_ROOT/schema-work"
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
FORCE_FLAG=""; if [ "$FORCE" = "1" ]; then FORCE_FLAG="--force"; fi
rbash force_flag="$FORCE_FLAG" <<'REMOTE'
cd "$DM_ROOT/schema-work"
# shellcheck disable=SC2086 — force_flag is either empty or exactly --force.
./node_modules/.bin/drizzle-kit push --config=drizzle.config.cjs $force_flag
REMOTE
ok "push complete"

# ── report ───────────────────────────────────────────────────────────────────
say "resulting schema"
rbash <<'REMOTE'
cd "$DM_ROOT/schema-work"
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
