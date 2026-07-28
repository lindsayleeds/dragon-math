#!/usr/bin/env bash
#
# Build one commit into $DM_ROOT/releases/<sha> on the target, then activate it
# by atomically replacing the `current` symlink and reloading pm2.
#
# The properties that matter:
#   * The release is assembled in releases/<sha>.incoming and only renamed into
#     place once the build succeeded, so a failed deploy leaves no half-release
#     and never touches the running site.
#   * `current` is swapped with `ln -sfn` to a temp name + `mv -T`, which is a
#     single rename(2). `rm` + `ln` would leave a window where the document root
#     does not exist and every request 404s.
#   * .env is a symlink into shared/, never a copy, so a rollback cannot restore
#     stale secrets.
#   * pm2 runs in cluster mode, so `reload` cycles workers one at a time and the
#     listening socket is never empty.
#
# Usage:
#   deploy/release.sh -t test [--ref REF] [--source git|local] [--keep N]
#                             [--no-reload] [--skip-smoke]
#
#   --ref REF        commit/branch/tag to deploy (default: target's DM_GIT_REF)
#   --source git     target fetches REF from DM_GIT_REMOTE (default; needs the
#                    commit to be pushed)
#   --source local   ship `git archive REF` from this checkout over ssh. Use for
#                    a commit that is not on the remote yet.
#   --no-reload      build and activate, but leave pm2 alone
#   --skip-smoke     skip the post-deploy HTTP checks
#   --rebuild        rebuild even if releases/<sha> already exists (refused when
#                    that release is the live one — see below)
#
# Releases are immutable and named by commit, so deploying a sha that is already
# built re-activates it instead of rebuilding. That is what makes this script
# safely re-runnable: rebuilding in place would mean rm -rf on the directory
# nginx is currently serving as its document root.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; REF=""; SOURCE="git"; RELOAD=1; SMOKE=1; KEEP=""; REBUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)   TARGET="${2:?}"; shift 2 ;;
    --ref)         REF="${2:?}"; shift 2 ;;
    --source)      SOURCE="${2:?}"; shift 2 ;;
    --keep)        KEEP="${2:?}"; shift 2 ;;
    --no-reload)   RELOAD=0; shift ;;
    --skip-smoke)  SMOKE=0; shift ;;
    --rebuild)     REBUILD=1; shift ;;
    -h|--help)     sed -n '2,30p' "$0"; exit 0 ;;
    *)             die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--ref REF] [--source git|local]"

load_target "$TARGET"
REF="${REF:-${DM_GIT_REF:-main}}"
KEEP="${KEEP:-${DM_KEEP_RELEASES:-5}}"
case "$SOURCE" in git|local) ;; *) die "--source must be 'git' or 'local'" ;; esac

require_ssh

SHA="$(resolve_sha "$REF")"
SHORT="${SHA:0:7}"
COMMIT_DATE="$(git -C "$DM_REPO_DIR" log -1 --format=%cI "$SHA")"
SUBJECT="$(git -C "$DM_REPO_DIR" log -1 --format=%s "$SHA")"

say "deploying $SHORT to $DM_HOSTNAME ($DM_SSH_HOST)"
printf '     ref      %s -> %s\n     subject  %s\n     source   %s\n' \
  "$REF" "$SHA" "$SUBJECT" "$SOURCE"

# Refuse to deploy an unbuilt layout rather than producing a confusing failure
# halfway through.
rbash <<'REMOTE'
[ -d "$DM_RELEASES" ] || { echo "$DM_RELEASES missing — run deploy/provision.sh first" >&2; exit 1; }
[ -f "$DM_SHARED/.env" ] || { echo "$DM_SHARED/.env missing — run deploy/provision.sh first" >&2; exit 1; }
REMOTE

INCOMING="$DM_RELEASES/$SHA.incoming"
RELEASE="$DM_RELEASES/$SHA"

# ── 0. is this commit already built? ─────────────────────────────────────────
# A release directory is an immutable artifact identified by its commit, so if it
# already exists there is nothing to build. This is not just an optimisation:
# rebuilding the release that `current` points at would rm -rf the live document
# root, and re-runnability is the whole point of committing these scripts.
state="$(rbash release="$RELEASE" <<'REMOTE'
if [ ! -d "$release" ]; then echo absent
elif [ "$(readlink -f "$DM_CURRENT" 2>/dev/null || true)" = "$release" ]; then echo active
else echo inactive
fi
REMOTE
)"

BUILD=1
case "$state" in
  absent)   ;;
  inactive)
    if [ "$REBUILD" = "1" ]; then
      say "releases/$SHORT exists but is not live — rebuilding it"
    else
      say "releases/$SHORT is already built (not live) — reusing it; pass --rebuild to force"
      BUILD=0
    fi ;;
  active)
    if [ "$REBUILD" = "1" ]; then
      die "releases/$SHORT is the LIVE release; rebuilding it would rm -rf the document
     root nginx is serving. Deploy a new commit instead, or roll to another
     release first with deploy/rollback.sh."
    fi
    say "releases/$SHORT is already built and live — re-activating (no rebuild)"
    BUILD=0 ;;
esac

if [ "$BUILD" = "1" ]; then
# ── 1. get the source tree onto the box ──────────────────────────────────────
say "staging source tree"
rbash <<REMOTE
rm -rf $(qq "$INCOMING")
mkdir -p $(qq "$INCOMING")
REMOTE

if [ "$SOURCE" = "git" ]; then
  # A cached clone means later deploys fetch only new objects.
  rbash <<REMOTE
cache="\$DM_ROOT/build-cache.git"
if [ ! -d "\$cache" ]; then
  git clone --bare $(qq "${DM_GIT_REMOTE:?target must define DM_GIT_REMOTE}") "\$cache"
fi
git -C "\$cache" fetch --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
git -C "\$cache" rev-parse --verify $(qq "$SHA^{commit}") >/dev/null 2>&1 \
  || { echo "commit $SHA is not on $(qq "${DM_GIT_REMOTE}") — push it, or use --source local" >&2; exit 1; }
git -C "\$cache" archive --format=tar $(qq "$SHA") | tar -x -C $(qq "$INCOMING")
REMOTE
else
  # Streamed straight into tar on the box — no temp file, and no second pass to
  # measure it (public/ is ~60 MB, so generating the archive twice is not free).
  say "shipping git archive of $SHORT over ssh"
  git -C "$DM_REPO_DIR" archive --format=tar "$SHA" \
    | rsh "tar -x -C $(qq "$INCOMING")"
fi
ok "source tree staged"

# ── 2. secrets symlink, then build ───────────────────────────────────────────
# The symlink goes in BEFORE the build because vite bakes
# VITE_GOOGLE_OAUTH_CLIENT_ID into the bundle at build time — a release built
# without it would render a disabled Google button no matter what the server
# env says later.
say "installing .env symlink and building"
rbash incoming="$INCOMING" sha="$SHA" commit_date="$COMMIT_DATE" <<'REMOTE'
cd "$incoming"
ln -sfn "$DM_SHARED/.env" .env

# Only the VITE_* vars are needed at build time. Sourcing the whole file would
# also drag secrets into the build environment for no reason.
#
# Each line is split and assigned directly — never eval'd or sourced. dotenv
# accepts unquoted values containing spaces and shell metacharacters, so handing
# these lines to the shell would abort the deploy on a syntax error at best and
# execute a `$(...)` in the secrets file at worst.
while IFS= read -r line; do
  key="${line%%=*}"
  val="${line#*=}"
  # Strip one layer of matching quotes, as dotenv does, so the value baked into
  # the bundle is the value the app sees at runtime.
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  export "$key=$val"
  echo "     build env $key"
done < <(grep -E '^VITE_[A-Z0-9_]+=' "$DM_SHARED/.env" || true)

echo "-- npm ci (with dev deps; vite is needed to build) --"
npm ci --no-audit --no-fund

echo "-- vite build --"
DM_COMMIT="$sha" DM_COMMIT_DATE="$commit_date" npm run build

[ -f dist/index.html ]   || { echo "build produced no dist/index.html" >&2; exit 1; }
[ -f dist/version.json ] || { echo "build produced no dist/version.json" >&2; exit 1; }
echo "-- version.json --"; cat dist/version.json

echo "-- npm prune to production deps --"
npm prune --omit=dev --no-audit --no-fund
REMOTE
ok "build complete"

# ── 3. rename into place (a release dir appears only when it is whole) ───────
say "finalising release directory"
rbash <<REMOTE
rm -rf $(qq "$RELEASE")
mv -T $(qq "$INCOMING") $(qq "$RELEASE")
du -sh $(qq "$RELEASE") | awk '{print "     release size " \$1}'
REMOTE
ok "release $SHORT ready at $RELEASE"
fi   # end if BUILD

# ── 4. atomic activation ─────────────────────────────────────────────────────
say "activating release (atomic symlink swap)"
rbash <<REMOTE
# Only a real symlink counts. \`readlink -f\` on a MISSING path happily
# canonicalises it to itself, which on a first deploy would record
# "<root>/current" as the rollback target — a path that is not a release.
prev=""
if [ -L "\$DM_CURRENT" ]; then prev="\$(readlink -f "\$DM_CURRENT" 2>/dev/null || true)"; fi
[ -n "\$prev" ] && echo "     previous  \$prev" || echo "     previous  (none — first deploy)"

# ln -sfn to a temp name, then mv -T: one rename(2), so there is never an
# instant where \$DM_CURRENT is absent. rm+ln would 404 the whole site.
tmp="\$DM_CURRENT.swap.\$\$"
ln -sfn $(qq "$RELEASE") "\$tmp"
mv -T "\$tmp" "\$DM_CURRENT"

# Remember what we came from so rollback.sh has a target even after a reboot.
if [ -n "\$prev" ] && [ "\$prev" != $(qq "$RELEASE") ]; then
  printf '%s\n' "\$prev" > "\$DM_SHARED/previous-release"
fi
echo "     current   \$(readlink "\$DM_CURRENT")"
REMOTE
ok "current -> releases/$SHORT"

# ── 5. pm2 ───────────────────────────────────────────────────────────────────
if [ "$RELOAD" = "1" ]; then
  say "reloading pm2 ($DM_PM2_APP, ${DM_PM2_EXEC_MODE:-cluster} x ${DM_PM2_INSTANCES:-2})"
  rbash <<REMOTE
cd "\$DM_CURRENT"
# startOrReload reads the ecosystem file from the release just activated, so the
# process config and the code always come from the same commit. In cluster mode
# this is a rolling reload: workers are replaced one at a time.
DM_ROOT="\$DM_ROOT" DM_PM2_APP="\$DM_PM2_APP" DM_API_PORT="\$DM_API_PORT" \
DM_API_HOST="\$DM_API_HOST" DM_PM2_INSTANCES="\$DM_PM2_INSTANCES" \
DM_PM2_EXEC_MODE="\$DM_PM2_EXEC_MODE" DM_ENVIRONMENT="\$DM_ENVIRONMENT" \
  pm2 startOrReload "\$DM_CURRENT/deploy/ecosystem.config.cjs" --update-env
pm2 save >/dev/null
pm2 describe "\$DM_PM2_APP" | grep -E 'status|exec mode|instances|script path' || true
REMOTE
  ok "pm2 reloaded"

  # Wait for the app's own readiness verdict before calling the deploy done.
  # GET /api/health (#8) is 503 until its `select 1` succeeds and reports the
  # commit from the release's own dist/version.json, so this confirms the new
  # workers are genuinely serving rather than merely "online" per pm2. Polled on
  # the box so a slow reload is not confused with a network problem.
  say "waiting for /api/health to report the new release"
  rbash want="$SHA" <<'REMOTE'
deadline=$((SECONDS + 60))
last=""
while [ $SECONDS -lt $deadline ]; do
  # ONE request per iteration, code appended to the body — the same form
  # deploy/verify.sh uses. Two requests would let the status code and the version
  # describe different responses, and /api/health runs a real (bounded) database
  # probe, so asking twice doubles the probe load for no extra information.
  res="$(curl -sS -m 5 -w '\n<<%{http_code}>>' "http://127.0.0.1:$DM_API_PORT/api/health" 2>/dev/null || true)"
  code="$(printf '%s' "$res" | sed -n 's/.*<<\([0-9]*\)>>.*/\1/p')"
  code="${code:-000}"
  body="$(printf '%s' "$res" | sed 's/<<[0-9]*>>//')"
  got="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  last="code=$code version=${got:-none}"
  if [ "$code" = "200" ] && [ "$got" = "$want" ]; then
    echo "     healthy: $last"
    exit 0
  fi
  # Deploying a commit from before /api/health existed (#8): there is nothing to
  # poll, so accept pm2's verdict rather than failing a legitimate deploy.
  if [ "$code" = "404" ]; then
    echo "     /api/health is absent — this commit predates the endpoint (#8); relying on pm2 status"
    exit 0
  fi
  sleep 2
done
echo "     /api/health did not report a healthy $want within 60s (last: $last)" >&2
echo "     the previous release is still on disk — roll back with deploy/rollback.sh" >&2
exit 1
REMOTE
  ok "health check passed"
else
  warn "--no-reload: pm2 left untouched"
fi

# ── 6. prune ─────────────────────────────────────────────────────────────────
say "pruning old releases (keeping $KEEP)"
rbash keep="$KEEP" <<'REMOTE'
cd "$DM_RELEASES"
cur=""
if [ -L "$DM_CURRENT" ]; then cur="$(readlink -f "$DM_CURRENT" 2>/dev/null || true)"; fi
prev="$(cat "$DM_SHARED/previous-release" 2>/dev/null || true)"

# Keep the $keep newest releases. Anything older is removed, EXCEPT the live
# release and the recorded rollback target, which are never candidates however
# old they are — losing either would leave the box unable to roll back.
# Counting includes the protected ones so "keep 5" means five directories, not
# five plus however many happen to be protected.
n=0
for d in $(ls -1dt */ 2>/dev/null | sed 's:/$::' || true); do
  path="$DM_RELEASES/$d"
  # A leftover .incoming is a failed build, never a release. Always sweep it.
  case "$d" in *.incoming) rm -rf "$path"; echo "     removed failed build $d"; continue ;; esac
  n=$((n+1))
  if [ "$n" -le "$keep" ]; then continue; fi
  if [ "$path" = "$cur" ]; then echo "     kept (live, outside window) $d"; continue; fi
  if [ "$path" = "$prev" ]; then echo "     kept (rollback target, outside window) $d"; continue; fi
  rm -rf "$path"
  echo "     pruned $d"
done
echo "     kept: $(ls -1dt */ 2>/dev/null | sed 's:/$::' | tr '\n' ' ')"
REMOTE
ok "prune done"

# ── 7. smoke ─────────────────────────────────────────────────────────────────
if [ "$SMOKE" = "1" ]; then
  say "smoke checks"
  "$DM_DEPLOY_DIR/verify.sh" -t "$TARGET" --expect-commit "$SHA"
fi

ok "deployed $SHORT to https://$DM_HOSTNAME"
