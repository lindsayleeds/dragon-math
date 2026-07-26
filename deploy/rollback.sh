#!/usr/bin/env bash
#
# Point `current` back at a previous release and reload pm2.
#
# A rollback is deliberately NOT a rebuild: the previous release directory is
# still on disk, fully built, so this is a symlink swap plus a pm2 reload and
# takes about a second. Because .env is a symlink into shared/, rolling back the
# code never rolls back the secrets.
#
# Usage:
#   deploy/rollback.sh -t test [--to SHA] [--list]
#
#   --to SHA   release to activate (default: shared/previous-release, i.e. the
#              release that was active before the last deploy)
#   --list     show available releases and exit

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; TO=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target) TARGET="${2:?}"; shift 2 ;;
    --to)        TO="${2:?}"; shift 2 ;;
    --list)      LIST=1; shift ;;
    -h|--help)   sed -n '2,16p' "$0"; exit 0 ;;
    *)           die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--to SHA]"
load_target "$TARGET"
require_ssh

if [ "$LIST" = "1" ]; then
  say "releases on $DM_SSH_HOST (newest first)"
  rbash <<'REMOTE'
cur="$(readlink -f "$DM_CURRENT" 2>/dev/null || true)"
prev="$(cat "$DM_SHARED/previous-release" 2>/dev/null || true)"
cd "$DM_RELEASES" 2>/dev/null || { echo "no releases directory"; exit 0; }
for d in $(ls -1dt */ 2>/dev/null | sed 's:/$::' || true); do
  mark=""
  if [ "$DM_RELEASES/$d" = "$cur" ];  then mark="  <- current"; fi
  if [ "$DM_RELEASES/$d" = "$prev" ]; then mark="$mark  <- rollback target"; fi
  printf '  %s  %s%s\n' "$(date -r "$d" '+%Y-%m-%d %H:%M')" "$d" "$mark"
done
REMOTE
  exit 0
fi

say "rolling back $DM_HOSTNAME"

# Resolve the target release, then swap. Same atomic dance as release.sh: a temp
# symlink renamed over `current`, never rm+ln.
rbash want="$TO" <<'REMOTE'
target="$want"
if [ -z "$target" ]; then
  target="$(cat "$DM_SHARED/previous-release" 2>/dev/null || true)"
  [ -n "$target" ] || { echo "no previous release recorded and no --to given" >&2; exit 1; }
else
  case "$target" in /*) ;; *) target="$DM_RELEASES/$target" ;; esac
fi

[ -d "$target" ] || { echo "release '$target' does not exist" >&2; exit 1; }
[ -f "$target/server/index.js" ] || { echo "'$target' is not a usable release (no server/index.js)" >&2; exit 1; }
[ -f "$target/dist/index.html" ] || { echo "'$target' is not a usable release (no dist/index.html)" >&2; exit 1; }

cur=""
if [ -L "$DM_CURRENT" ]; then cur="$(readlink -f "$DM_CURRENT" 2>/dev/null || true)"; fi
if [ "$cur" = "$target" ]; then
  echo "current is already $target — nothing to do" >&2; exit 1
fi

echo "     from  ${cur:-(nothing)}"
echo "     to    $target"

# Secrets must not travel with the code.
[ -L "$target/.env" ] || ln -sfn "$DM_SHARED/.env" "$target/.env"

# Same single-rename(2) swap as release.sh — never rm+ln.
tmp="$DM_CURRENT.swap.$$"
ln -sfn "$target" "$tmp"
mv -T "$tmp" "$DM_CURRENT"

# So a second rollback returns to where we just came from.
if [ -n "$cur" ]; then printf '%s\n' "$cur" > "$DM_SHARED/previous-release"; fi
echo "     current now $(readlink "$DM_CURRENT")"

cd "$DM_CURRENT"
pm2 startOrReload "$DM_CURRENT/deploy/ecosystem.config.cjs" --update-env
pm2 save >/dev/null
REMOTE

ok "rolled back"
say "verifying"
"$DM_DEPLOY_DIR/verify.sh" -t "$TARGET"
