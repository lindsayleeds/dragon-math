#!/usr/bin/env bash
#
# Prove a target is in the state we think it is. Run after provision, after
# every release, and any time the box is in doubt.
#
# Every check prints PASS/FAIL and the script exits non-zero if any failed, so
# it works as a deploy gate as well as a report. It is read-only: it changes
# nothing on the target.
#
# Usage:
#   deploy/verify.sh -t test [--expect-commit SHA]

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; EXPECT_COMMIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)      TARGET="${2:?}"; shift 2 ;;
    --expect-commit)  EXPECT_COMMIT="${2:?}"; shift 2 ;;
    -h|--help)        sed -n '2,14p' "$0"; exit 0 ;;
    *)                die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--expect-commit SHA]"
load_target "$TARGET"

PASS=0; FAIL=0
pass() { printf '  %sPASS%s %s\n' "$_c_g" "$_c_0" "$*"; PASS=$((PASS+1)); }
fail() { printf '  %sFAIL%s %s\n' "$_c_r" "$_c_0" "$*"; FAIL=$((FAIL+1)); }
# check <description> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then pass "$1 ($3)"; else fail "$1 — expected '$2', got '$3'"; fi
}
# checkc <description> <substring> <haystack>
checkc() {
  case "$3" in *"$2"*) pass "$1" ;; *) fail "$1 — '$2' not found in: $(printf '%s' "$3" | head -c 200)" ;; esac
}

BASE="https://$DM_HOSTNAME"
CURL=(curl -sS --max-time 25)
# Pin the hostname to the target's IP so every check provably describes THIS
# box. Without it a stale resolver entry silently redirects the whole suite at
# whatever host the name used to point to.
if [ -n "${DM_TARGET_IP:-}" ]; then
  CURL+=(--resolve "$DM_HOSTNAME:443:$DM_TARGET_IP" --resolve "$DM_HOSTNAME:80:$DM_TARGET_IP")
  SSL_CONNECT="$DM_TARGET_IP:443"
else
  SSL_CONNECT="$DM_HOSTNAME:443"
fi

say "verifying $DM_HOSTNAME ($DM_SSH_HOST, target '$TARGET')"
[ -n "${DM_TARGET_IP:-}" ] && printf '       checks pinned to %s\n' "$DM_TARGET_IP"

# Public DNS is reported, not asserted: right after a cutover a cached record is
# expected to linger and clear on its own, and that is not a deploy defect.
resolved="$(getent ahostsv4 "$DM_HOSTNAME" 2>/dev/null | awk '{print $1; exit}')"
if [ -z "$resolved" ]; then
  warn "this host cannot resolve $DM_HOSTNAME (no A record from the local resolver)"
elif [ -n "${DM_TARGET_IP:-}" ] && [ "$resolved" != "$DM_TARGET_IP" ]; then
  warn "public DNS from THIS machine still says $DM_HOSTNAME -> $resolved (target is $DM_TARGET_IP).
     Expected shortly after a DNS change: a resolver is serving a cached record.
     It clears on its own — do not repoint DNS. Checks below are pinned to the target."
else
  ok "$DM_HOSTNAME resolves to the target ($resolved)"
fi

# ── TLS + reachability ───────────────────────────────────────────────────────
say "TLS and reachability"
code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/" || echo 000)"
check "GET / over HTTPS" "200" "$code"

# --fail-with-body would mask a cert problem; check the handshake explicitly.
if "${CURL[@]}" -o /dev/null "$BASE/" 2>/dev/null; then
  pass "TLS certificate validates against the system trust store"
else
  fail "TLS handshake/validation failed for $BASE"
fi

cert_info="$(echo | openssl s_client -servername "$DM_HOSTNAME" -connect "$SSL_CONNECT" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || true)"
if [ -n "$cert_info" ]; then
  printf '%s\n' "$cert_info" | sed 's/^/       /'
  # Match the SAN, not the CN: that is what TLS clients actually validate
  # against, and OpenSSL 3 prints the subject as "CN = host" (spaced), so a
  # naive "CN=host" substring test gives a false negative on a correct cert.
  checkc "certificate SAN covers $DM_HOSTNAME" "DNS:$DM_HOSTNAME" "$cert_info"
  checkc "issued by Let's Encrypt" "Let's Encrypt" "$cert_info"
else
  fail "could not read the certificate"
fi

redirect="$("${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$DM_HOSTNAME/" || true)"
checkc "port 80 redirects to https" "https://$DM_HOSTNAME/" "$redirect"

# ── the deployed commit ──────────────────────────────────────────────────────
say "deployed version"
version="$("${CURL[@]}" "$BASE/version.json" || true)"
printf '%s\n' "$version" | sed 's/^/       /'
served_commit="$(printf '%s' "$version" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
if [ -n "$EXPECT_COMMIT" ]; then
  check "version.json commit matches the release" "$EXPECT_COMMIT" "$served_commit"
else
  [ -n "$served_commit" ] && pass "version.json reports commit ${served_commit:0:7}" \
    || fail "version.json has no commit"
fi

# ── search-engine blocking ───────────────────────────────────────────────────
say "search indexing blocked"
robots="$("${CURL[@]}" "$BASE/robots.txt" || true)"
checkc "robots.txt disallows everything" "Disallow: /" "$robots"
checkc "robots.txt applies to all agents" "User-agent: *" "$robots"

for p in "/" "/index.html" "/version.json" "/auth"; do
  h="$("${CURL[@]}" -D - -o /dev/null "$BASE$p" || true)"
  if printf '%s' "$h" | grep -qi '^x-robots-tag:.*noindex'; then
    pass "X-Robots-Tag: noindex on $p"
  else
    fail "X-Robots-Tag: noindex missing on $p"
  fi
done

# ── cache behaviour (must match production, see docs/NGINX.md) ───────────────
say "cache headers"
h="$("${CURL[@]}" -D - -o /dev/null "$BASE/index.html" || true)"
if printf '%s' "$h" | grep -qi '^cache-control:.*no-cache'; then
  pass "index.html is no-cache"; else fail "index.html is not no-cache"; fi

h="$("${CURL[@]}" -D - -o /dev/null "$BASE/version.json" || true)"
if printf '%s' "$h" | grep -qi '^cache-control:.*no-cache'; then
  pass "version.json is no-cache"; else fail "version.json is not no-cache"; fi

# Pick a real hashed asset out of the served index.html rather than guessing.
asset="$("${CURL[@]}" "$BASE/index.html" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1 || true)"
if [ -n "$asset" ]; then
  h="$("${CURL[@]}" -D - -o /dev/null "$BASE$asset" || true)"
  if printf '%s' "$h" | grep -qi '^cache-control:.*immutable'; then
    pass "$asset is immutable long-cache"; else fail "$asset is not immutable"; fi
else
  fail "found no /assets/*.js reference in index.html"
fi

miss="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/assets/definitely-not-a-real-chunk.js" || echo 000)"
check "missing asset 404s instead of returning the SPA" "404" "$miss"

# ── API ──────────────────────────────────────────────────────────────────────
say "API through nginx"
code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" || echo 000)"
check "GET /api/auth/me is 401 without a token (API is live)" "401" "$code"
code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/nope-not-a-route" || echo 000)"
check "unknown /api/ path 404s as JSON, not the SPA shell" "404" "$code"

# GET /api/health (added in #8) is the app's own readiness verdict, and it reads
# dist/version.json out of the release it is running from — so it proves which
# release answered and that that release can actually reach the database.
health="$("${CURL[@]}" -w '\n<<%{http_code}>>' "$BASE/api/health" || true)"
hcode="$(printf '%s' "$health" | sed -n 's/.*<<\([0-9]*\)>>.*/\1/p')"
hbody="$(printf '%s' "$health" | sed 's/<<[0-9]*>>//')"
printf '%s\n' "$hbody" | sed 's/^/       /'
# A 404 means this release predates the /api/health endpoint (#8). That is a real
# possibility when verifying a rollback to an older artifact, and it is not a
# deployment fault — so it warns rather than failing. Any other non-200 (503 from
# a failed db probe, 000 from no answer at all) is a genuine failure.
if [ "$hcode" = "404" ]; then
  warn "/api/health returned 404 — this release predates the endpoint (#8); skipping health assertions"
  HEALTH_PRESENT=0
else
  HEALTH_PRESENT=1
  check "GET /api/health is 200" "200" "$hcode"
fi
if [ "$HEALTH_PRESENT" = "1" ]; then
checkc "health reports status ok" '"status":"ok"' "$(printf '%s' "$hbody" | tr -d ' ')"
# checks.db is a flat verdict string ('ok' | 'timeout' | 'error'), not an object
# — see buildHealth() in server/lib/health.js.
checkc "health db check passes (the app can reach the database)" '"db":"ok"' "$(printf '%s' "$hbody" | tr -d ' ')"
hver="$(printf '%s' "$hbody" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -n "$EXPECT_COMMIT" ]; then
  check "health reports the release's commit" "$EXPECT_COMMIT" "$hver"
elif [ -n "$served_commit" ]; then
  # Without an expectation, at least assert the API and the static bundle agree.
  check "health commit matches version.json" "$served_commit" "$hver"
fi
fi   # end if HEALTH_PRESENT

# ── on-box state ─────────────────────────────────────────────────────────────
say "release layout and process topology"
remote_report="$(rbash <<'REMOTE'
echo "CURRENT=$(readlink "$DM_CURRENT" 2>/dev/null || echo none)"
echo "ROOT_IS_SYMLINK=$( [ -L "$DM_CURRENT" ] && echo yes || echo no )"
echo "ENV_IS_SYMLINK=$( [ -L "$DM_CURRENT/.env" ] && echo yes || echo no )"
echo "ENV_TARGET=$(readlink "$DM_CURRENT/.env" 2>/dev/null || echo none)"
echo "ENV_IN_RELEASE=$( [ -f "$(readlink -f "$DM_CURRENT")/.env" ] && [ ! -L "$(readlink -f "$DM_CURRENT")/.env" ] && echo yes || echo no )"
echo "RELEASE_COUNT=$(ls -1d "$DM_RELEASES"/*/ 2>/dev/null | wc -l)"
echo "PREVIOUS=$(cat "$DM_SHARED/previous-release" 2>/dev/null || echo none)"
echo "ENV_MODE=$(stat -c %a "$DM_SHARED/.env" 2>/dev/null || echo none)"
echo "IS_GIT_CHECKOUT=$( [ -d "$(readlink -f "$DM_CURRENT")/.git" ] && echo yes || echo no )"

# pm2: mode, instance count, how many are online
echo "PM2_MODE=$(pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const a=JSON.parse(s).find(x=>x.name===process.env.DM_PM2_APP)||{};
 console.log(a.pm2_env?.exec_mode||"missing");});')"
echo "PM2_ONLINE=$(pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const a=JSON.parse(s).filter(x=>x.name===process.env.DM_PM2_APP);
 console.log(a.filter(x=>x.pm2_env?.status==="online").length);});')"
echo "PM2_TOTAL=$(pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 console.log(JSON.parse(s).filter(x=>x.name===process.env.DM_PM2_APP).length);});')"

# Which release the running workers actually resolved to.
pids="$(pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 console.log(JSON.parse(s).filter(x=>x.name===process.env.DM_PM2_APP).map(x=>x.pid).filter(Boolean).join(" "));});')"
for p in $pids; do echo "WORKER_CWD=$(readlink /proc/$p/cwd 2>/dev/null || echo unknown)"; done

# Listener: must be loopback-only, and on the expected port.
echo "LISTEN=$(ss -ltnH "sport = :$DM_API_PORT" | awk '{print $4}' | paste -sd, -)"

# Scheduled jobs: read it out of the boot log rather than trusting the config.
echo "CRON_LOG=$(grep -h 'Scheduled jobs' ~/.pm2/logs/${DM_PM2_APP}-out.log 2>/dev/null | tail -1 | sed 's/.*Scheduled jobs/Scheduled jobs/')"

# Which database, by project ref only — never the credential.
echo "DB_USER=$(grep -m1 '^DATABASE_URL=' "$DM_SHARED/.env" | sed -E 's|^DATABASE_URL=postgresql://([^:]+):.*|\1|')"
echo "DB_HOST=$(grep -m1 '^DATABASE_URL=' "$DM_SHARED/.env" | sed -E 's|.*@([^:/]+).*|\1|')"
echo "STRIPE_LIVE=$(grep -vE '^[[:space:]]*#' "$DM_SHARED/.env" | grep -cE '=.*(sk|pk|rk)_live_' || true)"
echo "ENABLE_CRON=$(grep -m1 '^ENABLE_CRON=' "$DM_SHARED/.env" | cut -d= -f2-)"
echo "APP_PUBLIC_URL=$(grep -m1 '^APP_PUBLIC_URL=' "$DM_SHARED/.env" | cut -d= -f2-)"
REMOTE
)"
printf '%s\n' "$remote_report" | sed 's/^/       /'
r() { printf '%s' "$remote_report" | grep -m1 "^$1=" | cut -d= -f2- || true; }

check "current is a symlink" "yes" "$(r ROOT_IS_SYMLINK)"
check "the active release is NOT a git checkout" "no" "$(r IS_GIT_CHECKOUT)"
check "release .env is a symlink" "yes" "$(r ENV_IS_SYMLINK)"
check "no real .env file inside the release" "no" "$(r ENV_IN_RELEASE)"
checkc ".env points into shared/" "/shared/.env" "$(r ENV_TARGET)"
check "shared/.env is mode 600" "600" "$(r ENV_MODE)"

# pm2 reports this as "cluster_mode" in jlist and "cluster" in `pm2 list`.
case "$(r PM2_MODE)" in
  cluster|cluster_mode) pass "pm2 exec mode ($(r PM2_MODE))" ;;
  *)                    fail "pm2 exec mode — expected cluster, got '$(r PM2_MODE)'" ;;
esac
check "pm2 instance count" "${DM_PM2_INSTANCES:-2}" "$(r PM2_TOTAL)"
check "pm2 instances online" "${DM_PM2_INSTANCES:-2}" "$(r PM2_ONLINE)"

listen="$(r LISTEN)"
if printf '%s' "$listen" | grep -q '127.0.0.1'; then
  pass "API listens on loopback ($listen)"
else
  fail "API is not loopback-only: $listen"
fi
if printf '%s' "$listen" | grep -qE '(^|,)(0\.0\.0\.0|\*):'; then
  fail "API is bound to a public interface: $listen"
else
  pass "API is not bound to any public interface"
fi

cron_log="$(r CRON_LOG)"
checkc "boot log confirms no scheduled jobs" "NOT registered" "$cron_log"
case "$(r ENABLE_CRON)" in
  0|false|no|off) pass "shared/.env has ENABLE_CRON=$(r ENABLE_CRON)" ;;
  *)              fail "shared/.env ENABLE_CRON='$(r ENABLE_CRON)' — cron would be armed" ;;
esac

if [ -n "${DM_EXPECTED_DB_REF:-}" ]; then
  checkc "DATABASE_URL points at the expected project ($DM_EXPECTED_DB_REF)" \
    "$DM_EXPECTED_DB_REF" "$(r DB_USER)"
fi
check "no live Stripe key on the box" "0" "$(r STRIPE_LIVE)"
check "APP_PUBLIC_URL is this host" "https://$DM_HOSTNAME" "$(r APP_PUBLIC_URL)"

# Every worker must be running the release `current` points at.
active="$(r CURRENT)"
worker_cwds="$(printf '%s' "$remote_report" | grep '^WORKER_CWD=' | cut -d= -f2- | sort -u)"
if [ -z "$worker_cwds" ]; then
  fail "no running workers found for $DM_PM2_APP"
elif [ "$(printf '%s\n' "$worker_cwds" | wc -l)" = "1" ] && [ "$worker_cwds" = "$active" ]; then
  pass "all workers are running the active release ($(basename "$active" | cut -c1-7))"
else
  fail "workers are not all on the active release: workers=[$worker_cwds] current=$active"
fi

# ── summary ──────────────────────────────────────────────────────────────────
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  ok "$PASS checks passed, 0 failed"
else
  printf '%sFAIL%s %d passed, %d FAILED\n' "$_c_r" "$_c_0" "$PASS" "$FAIL" >&2
  exit 1
fi
