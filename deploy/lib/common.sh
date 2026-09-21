#!/usr/bin/env bash
# Shared helpers for the database scripts. Sourced, not executed.
#
# These scripts run on a workstation and connect straight to the environment's
# Supabase database over its own connection string. They used to drive a Linux
# box over ssh, because that box was where the secrets lived; the boxes were
# retired on 2026-09-21 when production joined test on Cloud Run, and the
# connection string now comes from an env file the operator supplies.

set -euo pipefail

DM_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DM_REPO_DIR="$(cd "$DM_DEPLOY_DIR/.." && pwd)"
export DM_REPO_DIR

# ── output ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  _c_r=$'\033[31m'; _c_g=$'\033[32m'; _c_y=$'\033[33m'; _c_b=$'\033[1m'; _c_0=$'\033[0m'
else
  _c_r=''; _c_g=''; _c_y=''; _c_b=''; _c_0=''
fi
say()  { printf '%s==>%s %s\n' "$_c_b" "$_c_0" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$_c_g" "$_c_0" "$*"; }
warn() { printf '%swarn%s %s\n' "$_c_y" "$_c_0" "$*" >&2; }
die()  { err "$*"; exit 1; }
# die without the exit, for a function whose caller decides what to do next.
err()  { printf '%sFAIL%s %s\n' "$_c_r" "$_c_0" "$*" >&2; }

# ── environment config ───────────────────────────────────────────────────────
# Loads deploy/environments/<name>.env, which holds NON-SECRET facts only:
# which Cloud Run service the environment is, and which Supabase project its
# database must be. Values already present in the environment win, so any
# setting can be overridden per invocation.
load_environment() {
  local name="${1:?environment name required}"
  local file="$DM_DEPLOY_DIR/environments/$name.env"
  [ -f "$file" ] || die "no such environment '$name' (expected $file)"

  # Snapshot pre-existing DM_* overrides so the file cannot clobber them.
  local pre; pre="$(mktemp)"
  ( set -o posix; set ) | grep -E '^DM_[A-Z_]+=' > "$pre" || true

  # Both sources are non-constant paths, so SC1090 cannot check them. Keep the
  # `.` on its own line: a directive binds to the next COMMAND, so on a
  # `set -a; . "$file"; set +a` one-liner it lands on the `set` and the
  # suppression silently does nothing.
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
  set -a
  # shellcheck disable=SC1090
  . "$pre"
  set +a
  rm -f "$pre"

  : "${DM_ENVIRONMENT:?environment must define DM_ENVIRONMENT}"
  : "${DM_EXPECTED_DB_REF:?environment must define DM_EXPECTED_DB_REF}"

  DM_TARGET="$name"
  export DM_TARGET

  # A production environment must never be reached by accident.
  if [ "$DM_ENVIRONMENT" = "production" ] && [ "${DM_I_MEAN_PRODUCTION:-0}" != "1" ]; then
    die "environment '$name' is production; refusing (set DM_I_MEAN_PRODUCTION=1 to override)"
  fi
}

# ── the env file holding DATABASE_URL ────────────────────────────────────────
# Never committed. Write it from Secret Manager immediately before a run and
# delete it afterwards; see deploy/README.md.
require_env_file() {
  : "${DM_ENV_FILE:?--env-file is required (path to a file assigning DATABASE_URL)}"
  [ -f "$DM_ENV_FILE" ] || die "no such env file: $DM_ENV_FILE"

  # A world-readable secrets file on a shared workstation is the failure this
  # catches. sondapor held ~10 other apps and their operators.
  local mode; mode="$(stat -c '%a' "$DM_ENV_FILE")"
  case "$mode" in
    600|400) ;;
    *) die "env file $DM_ENV_FILE is mode $mode; it holds a database password — chmod 600 it" ;;
  esac

  # dotenv keeps the LAST duplicate assignment and leaves an existing
  # environment variable alone, so a file with two of them does not mean what
  # it looks like it means. Refuse rather than guess.
  local assignments
  assignments="$(grep -cE '^\s*(export\s+)?DATABASE_URL\s*=' "$DM_ENV_FILE" || true)"
  [ "$assignments" = "1" ] || die "$DM_ENV_FILE assigns DATABASE_URL $assignments times; expected exactly 1"

  export DM_ENV_FILE
}

# ── which database is this, really ───────────────────────────────────────────
# Resolves DATABASE_URL exactly as the application's dotenv does, from the env
# file, and asserts the Supabase project ref matches the environment. Prints no
# secret. Nothing that can touch a database may run before this passes.
assert_database() {
  local resolved
  resolved="$(DM_ENV_FILE="$DM_ENV_FILE" DM_EXPECTED_DB_REF="$DM_EXPECTED_DB_REF" \
    node -e '
      const fs = require("fs");
      const dotenv = require("dotenv");
      const url = dotenv.parse(fs.readFileSync(process.env.DM_ENV_FILE, "utf8")).DATABASE_URL;
      if (!url) throw new Error("no DATABASE_URL in the env file");
      if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
        throw new Error("an ambient DATABASE_URL disagrees with the env file");
      }
      const { hostname, username } = new URL(url);
      // Supabase encodes the project ref in the pooler username
      // (postgres.<ref>) and in a direct hostname (db.<ref>.supabase.co).
      const ref = (username.match(/^postgres\.([a-z0-9]+)$/) || [])[1]
               || (hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/) || [])[1];
      if (!ref) throw new Error("cannot read a Supabase project ref from DATABASE_URL");
      console.log(ref + " " + hostname);
    ' 2>&1)" || die "could not resolve DATABASE_URL: $resolved"

  local ref host
  ref="${resolved%% *}"; host="${resolved##* }"
  [ "$ref" = "$DM_EXPECTED_DB_REF" ] \
    || die "env file points at Supabase project '$ref', but environment '$DM_TARGET' expects '$DM_EXPECTED_DB_REF' — refusing"
  ok "database $ref ($host)"
}
