#!/usr/bin/env bash
# Grant/revoke admin for an existing verified adult. No automatic email allow-list.
# Usage: bash deploy/admin-account.sh -t test --email person@example.com --action grant
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
TARGET=""; EMAIL=""; ACTION=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target) TARGET="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --action) ACTION="${2:?}"; shift 2 ;;
    *) die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] && [ -n "$EMAIL" ] || die "target and email required"
case "$ACTION" in grant|revoke) ;; *) die "action must be grant or revoke" ;; esac
load_target "$TARGET"
: "${DM_EXPECTED_DB_REF:?target must specify a database project}"
require_ssh
SCRIPT="$(base64 -w0 "$(dirname "${BASH_SOURCE[0]}")/../scripts/admin-account.cjs")"
rbash DM_ADMIN_EMAIL="$EMAIL" DM_ADMIN_ACTION="$ACTION" DM_EXPECTED_DB_REF="$DM_EXPECTED_DB_REF" admin_script="$SCRIPT" <<'REMOTE'
cd "$DM_CURRENT"
export DM_ENV_FILE="$DM_SHARED/.env"
node -e 'eval(Buffer.from(process.env.admin_script, "base64").toString()); module.exports.main().catch(err => { console.error(err.message); process.exitCode = 1; })'
REMOTE
