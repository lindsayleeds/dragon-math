#!/usr/bin/env bash
#
# Remove the Supabase Data API's access to an environment's database, so the
# only way in is the app's own `postgres` connection.
#
# WHY THIS EXISTS
#
# Both Supabase projects expose a PostgREST Data API. Authorisation for it is
# ordinary Postgres privilege: a request carrying the project's anon key acts as
# the `anon` role. The test project grants `anon` nothing, so its API can reach
# nothing. Production was created with the old permissive default and grants
# `anon`/`authenticated` full DML on every table in `public`, plus USAGE on the
# schema, plus — the part that matters most — DEFAULT privileges that hand the
# same rights to every table created in future. That is why `rate_limits` was
# born readable by `anon` the moment drizzle created it.
#
# Nothing in this app uses the Data API: `@supabase/supabase-js` is not a
# dependency, no anon key exists in any env, and the server connects as
# `postgres` (table owner, `bypassrls`). So revoking costs nothing here and the
# test project is the live proof — it has run this way all along.
#
# This script makes an environment match test. It is idempotent: run it twice
# and the second run changes nothing.
#
# ROLLBACK
#
# Before changing anything it writes the GRANT statements that would restore the
# current state to ./db-harden-rollback-<timestamp>.sql and prints the path.
# Feed that file back through psql to undo.
#
# Usage:
#   deploy/db-harden.sh -e prod --env-file /path/to/db.env [--dry-run]
#
#   --env-file F  file assigning DATABASE_URL, mode 600 (see deploy/README.md)
#   --dry-run     run every guard, report the current state and the statements
#                 that would be issued, then stop without touching privileges.
#
# The guard is the same allow-list as db-push.sh: DATABASE_URL must name the
# project ref in deploy/environments/<name>.env, or nothing runs.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ENVIRONMENT=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -e|-t|--environment|--target) ENVIRONMENT="${2:?}"; shift 2 ;;
    --env-file)   DM_ENV_FILE="${2:?}"; shift 2 ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    sed -n '2,39p' "$0"; exit 0 ;;
    *)            die "unknown argument '$1'" ;;
  esac
done
[ -n "$ENVIRONMENT" ] || die "usage: $0 -e <environment> --env-file <file> [--dry-run]"

load_environment "$ENVIRONMENT"
require_env_file

say "hardening database privileges on '$ENVIRONMENT' (expected project: $DM_EXPECTED_DB_REF)"
[ "$DRY" = "1" ] && warn "--dry-run: no privileges will be changed"

say "checking which database this will affect"
assert_database

ROLLBACK="$PWD/db-harden-rollback-$(date +%Y%m%dT%H%M%S).sql"

cd "$DM_REPO_DIR"
DM_ENV_FILE="$DM_ENV_FILE" \
DM_EXPECTED_DB_REF="$DM_EXPECTED_DB_REF" \
DM_APPLY="$([ "$DRY" = "1" ] && echo 0 || echo 1)" \
DM_ROLLBACK_PATH="$ROLLBACK" \
  node scripts/db-harden.cjs \
  || die "hardening failed — no privileges were changed unless the log above says otherwise"

if [ "$DRY" = "1" ]; then
  warn "--dry-run: nothing was changed"
else
  ok "privileges hardened on '$ENVIRONMENT' (rollback: $ROLLBACK)"
  say "confirm the app is unaffected: curl https://$DM_HOSTNAME/api/health"
fi
