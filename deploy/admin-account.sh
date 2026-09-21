#!/usr/bin/env bash
# Grant/revoke admin for an existing verified adult. No automatic email allow-list.
#
# Usage:
#   bash deploy/admin-account.sh -e test --env-file /path/to/db.env \
#        --email person@example.com --action grant
#
# Runs locally against the environment's Supabase database. See docs/ADMIN.md.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
ENVIRONMENT=""; EMAIL=""; ACTION=""
while [ $# -gt 0 ]; do
  case "$1" in
    -e|-t|--environment|--target) ENVIRONMENT="${2:?}"; shift 2 ;;
    --env-file) DM_ENV_FILE="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --action) ACTION="${2:?}"; shift 2 ;;
    *) die "unknown argument '$1'" ;;
  esac
done
[ -n "$ENVIRONMENT" ] && [ -n "$EMAIL" ] || die "environment and email required"
case "$ACTION" in grant|revoke) ;; *) die "action must be grant or revoke" ;; esac

load_environment "$ENVIRONMENT"
require_env_file
assert_database

say "$ACTION admin for $EMAIL on '$ENVIRONMENT'"
cd "$DM_REPO_DIR"
DM_ADMIN_EMAIL="$EMAIL" DM_ADMIN_ACTION="$ACTION" \
DM_EXPECTED_DB_REF="$DM_EXPECTED_DB_REF" DM_ENV_FILE="$DM_ENV_FILE" \
  node scripts/admin-account.cjs
