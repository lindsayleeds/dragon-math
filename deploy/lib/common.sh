#!/usr/bin/env bash
# Shared helpers for the deploy scripts. Sourced, not executed.
#
# Every script here runs on a workstation and drives the target box over ssh,
# so there is nothing to bootstrap on the server and the whole procedure stays
# in version control.

set -euo pipefail

DM_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DM_REPO_DIR="$(cd "$DM_DEPLOY_DIR/.." && pwd)"

# ── output ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  _c_r=$'\033[31m'; _c_g=$'\033[32m'; _c_y=$'\033[33m'; _c_b=$'\033[1m'; _c_0=$'\033[0m'
else
  _c_r=''; _c_g=''; _c_y=''; _c_b=''; _c_0=''
fi
say()  { printf '%s==>%s %s\n' "$_c_b" "$_c_0" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$_c_g" "$_c_0" "$*"; }
warn() { printf '%swarn%s %s\n' "$_c_y" "$_c_0" "$*" >&2; }
die()  { printf '%sFAIL%s %s\n' "$_c_r" "$_c_0" "$*" >&2; exit 1; }

# ── target config ────────────────────────────────────────────────────────────
# Loads deploy/targets/<name>.env. Values already present in the environment
# win, so any setting can be overridden per invocation.
load_target() {
  local name="${1:?target name required}"
  local file="$DM_DEPLOY_DIR/targets/$name.env"
  [ -f "$file" ] || die "no such target '$name' (expected $file)"

  # Snapshot pre-existing DM_* overrides so the file cannot clobber them.
  local pre; pre="$(mktemp)"
  ( set -o posix; set ) | grep -E '^DM_[A-Z_]+=' > "$pre" || true

  # shellcheck disable=SC1090
  set -a; . "$file"; set +a
  # shellcheck disable=SC1090
  set -a; . "$pre"; set +a
  rm -f "$pre"

  : "${DM_SSH_HOST:?target must define DM_SSH_HOST}"
  : "${DM_HOSTNAME:?target must define DM_HOSTNAME}"
  : "${DM_ROOT:?target must define DM_ROOT}"
  : "${DM_PM2_APP:?target must define DM_PM2_APP}"

  DM_TARGET="$name"
  DM_RELEASES="$DM_ROOT/releases"
  DM_SHARED="$DM_ROOT/shared"
  DM_CURRENT="$DM_ROOT/current"
  export DM_TARGET DM_RELEASES DM_SHARED DM_CURRENT

  # Every name this site answers on. DM_HOSTNAME_ALIASES is optional and
  # space-separated (production adds its `www.` name); most targets have none.
  #
  # DM_HOSTNAME is always FIRST and that is load-bearing: certbot names the
  # certificate lineage after the first -d, and provision.sh and verify.sh both
  # look for the certificate at /etc/letsencrypt/live/$DM_HOSTNAME. Reordering
  # this would point them at a lineage that does not exist.
  DM_SERVER_NAMES="$DM_HOSTNAME${DM_HOSTNAME_ALIASES:+ $DM_HOSTNAME_ALIASES}"
  export DM_SERVER_NAMES

  # A production target must never be reachable by these stage-one scripts by
  # accident. Refuse anything that looks like it while the pipeline is unbuilt.
  if [ "${DM_ENVIRONMENT:-}" = "production" ] && [ "${DM_I_MEAN_PRODUCTION:-0}" != "1" ]; then
    die "target '$name' is a production environment; refusing (set DM_I_MEAN_PRODUCTION=1 to override)"
  fi
}

# ── ssh ──────────────────────────────────────────────────────────────────────
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o LogLevel=ERROR)

# Run a command on the target. stdin is forwarded, so this doubles as the
# channel for piping tarballs and generated files to the box.
rsh() { ssh "${SSH_OPTS[@]}" "$DM_SSH_HOST" "$@"; }

# Run a bash snippet (on stdin) on the target with `set -euo pipefail` and the
# DM_* configuration exported, so remote snippets read the same variables.
#
# Extra per-call values are passed as leading NAME=VALUE arguments:
#
#     rbash tree="$TREE" <<'REMOTE'
#     ls "$tree"
#     REMOTE
#
# Always prefer that over interpolating into an unquoted heredoc. With <<REMOTE
# the LOCAL shell expands the body first, so a remote `$(wc -l ...)` runs on the
# workstation and an embedded `$1` (e.g. a pg placeholder in an inlined node
# script) is eaten by `set -u`. A quoted <<'REMOTE' plus bindings can't do that.
rbash() {
  local extra=""
  while [ $# -gt 0 ]; do
    case "$1" in
      [A-Za-z_]*=*) extra+=" ${1%%=*}=$(qq "${1#*=}")"; shift ;;
      *)            die "rbash: expected NAME=VALUE, got '$1'" ;;
    esac
  done
  local script; script="$(cat)"
  rsh "$extra DM_ROOT=$(qq "$DM_ROOT") DM_RELEASES=$(qq "$DM_RELEASES") \
       DM_SHARED=$(qq "$DM_SHARED") DM_CURRENT=$(qq "$DM_CURRENT") \
       DM_PM2_APP=$(qq "$DM_PM2_APP") DM_HOSTNAME=$(qq "$DM_HOSTNAME") \
       DM_API_PORT=$(qq "${DM_API_PORT:-4070}") DM_API_HOST=$(qq "${DM_API_HOST:-127.0.0.1}") \
       DM_PM2_INSTANCES=$(qq "${DM_PM2_INSTANCES:-2}") \
       DM_PM2_EXEC_MODE=$(qq "${DM_PM2_EXEC_MODE:-cluster}") \
       DM_KEEP_RELEASES=$(qq "${DM_KEEP_RELEASES:-5}") \
       DM_ENVIRONMENT=$(qq "${DM_ENVIRONMENT:-test}") \
       bash -euo pipefail -s" <<<"$script"
}

# Shell-quote a value for safe interpolation into a remote command line.
qq() { printf '%q' "$1"; }

require_ssh() {
  say "checking ssh to $DM_SSH_HOST"
  rsh true 2>/dev/null || die "cannot ssh non-interactively to '$DM_SSH_HOST'"
  ok "ssh $DM_SSH_HOST"
}

# ── misc ─────────────────────────────────────────────────────────────────────
# Resolve a git ref in the local repo to a full sha.
resolve_sha() {
  local ref="${1:?ref required}"
  git -C "$DM_REPO_DIR" rev-parse --verify "$ref^{commit}" 2>/dev/null \
    || die "cannot resolve git ref '$ref' in $DM_REPO_DIR"
}

# Search-engine blocking is a per-target setting (DM_ROBOTS_NOINDEX), but
# envsubst does literal substitution and has no conditionals — so the decision
# is resolved into two substitution values here and the template only
# interpolates the result.
#
# Unset means BLOCK. A target that forgets the knob must not become indexable by
# accident; only an explicit off value turns it off.
#
# DM_NOINDEX_HEADER is interpolated into EVERY location rather than declared once
# at server level: nginx's add_header is not inherited into a location that
# declares its own add_header, so a single server-level directive would silently
# vanish on exactly the responses that matter (index.html, /assets/,
# version.json).
robots_substitutions() {
  case "${DM_ROBOTS_NOINDEX:-1}" in
    0|false|no|off)
      DM_NOINDEX_HEADER=""
      DM_ROBOTS_LOCATION=""
      ;;
    *)
      DM_NOINDEX_HEADER='add_header X-Robots-Tag "noindex, nofollow, noarchive" always;'
      DM_ROBOTS_LOCATION="$(cat <<'BLOCK'
location = /robots.txt {
        add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
        add_header Cache-Control "no-cache, must-revalidate" always;
        default_type "text/plain";
        return 200 "User-agent: *\nDisallow: /\n";
    }
BLOCK
)"
      ;;
  esac
  export DM_NOINDEX_HEADER DM_ROBOTS_LOCATION
}

# True when the target expects search indexing to be blocked. Used by verify.sh
# so its robots assertions follow the target config instead of hardcoding one
# environment's answer.
robots_noindex_expected() {
  case "${DM_ROBOTS_NOINDEX:-1}" in
    0|false|no|off) return 1 ;;
    *)              return 0 ;;
  esac
}

# True when the target expects scheduled jobs to be armed. Defaults to OFF: the
# check that stops a non-production box emailing real parents must not be
# something a target can silently skip by omitting a variable.
cron_expected() {
  case "${DM_EXPECT_CRON:-0}" in
    1|true|yes|on) return 0 ;;
    *)             return 1 ;;
  esac
}

# Render a template, substituting only the DM_* placeholders we define. Using
# an explicit variable list stops envsubst from eating nginx's own $variables
# ($host, $uri, $http_upgrade, ...).
render_template() {
  local tpl="${1:?template required}"
  [ -f "$tpl" ] || die "missing template $tpl"
  robots_substitutions
  envsubst '$DM_HOSTNAME $DM_SERVER_NAMES $DM_ROOT $DM_API_PORT $DM_ENVIRONMENT $DM_ACME_WEBROOT $DM_NOINDEX_HEADER $DM_ROBOTS_LOCATION' < "$tpl"
}
