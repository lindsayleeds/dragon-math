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

# Every alias in DM_HOSTNAME_ALIASES must be on the certificate AND served, or
# the site is broken for whoever types it. Asserted rather than assumed because
# the failure is silent from the apex's point of view: provision.sh sends one -d
# per configured name, so a target that drops an alias gets a REDUCED
# certificate, and nothing else here would notice. Each alias is pinned to
# DM_TARGET_IP the same way the apex is.
for alias in ${DM_HOSTNAME_ALIASES:-}; do
  checkc "certificate SAN covers $alias" "DNS:$alias" "$cert_info"

  ACURL=(curl -sS --max-time 25)
  [ -n "${DM_TARGET_IP:-}" ] && ACURL+=(--resolve "$alias:443:$DM_TARGET_IP" --resolve "$alias:80:$DM_TARGET_IP")

  acode="$("${ACURL[@]}" -o /dev/null -w '%{http_code}' "https://$alias/" || echo 000)"
  check "GET / over HTTPS on $alias" "200" "$acode"

  # A wrong-name certificate still completes a handshake, so validate the chain
  # against the alias specifically instead of trusting the apex's result.
  if "${ACURL[@]}" -o /dev/null "https://$alias/" 2>/dev/null; then
    pass "TLS validates for $alias"
  else
    fail "TLS handshake/validation failed for https://$alias (is it on the certificate?)"
  fi

  aredir="$("${ACURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$alias/" || true)"
  checkc "port 80 redirects to https on $alias" "https://$alias/" "$aredir"
done

# ── the deployed commit ──────────────────────────────────────────────────────
say "deployed version"
version="$("${CURL[@]}" "$BASE/version.json" || true)"
printf '%s\n' "$version" | sed 's/^/       /'
served_commit="$(printf '%s' "$version" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
if [ -n "$EXPECT_COMMIT" ]; then
  check "version.json commit matches the release" "$EXPECT_COMMIT" "$served_commit"
else
  if [ -n "$served_commit" ]; then
    pass "version.json reports commit ${served_commit:0:7}"
  else
    fail "version.json has no commit"
  fi
fi

# ── search-engine blocking ───────────────────────────────────────────────────
# Driven by the target's DM_ROBOTS_NOINDEX (default: blocked), the same setting
# provision.sh renders the nginx config from — so this asserts what the target
# asked for rather than one environment's answer.
if robots_noindex_expected; then
  say "search indexing blocked (DM_ROBOTS_NOINDEX=${DM_ROBOTS_NOINDEX:-1})"
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
else
  say "search indexing allowed (DM_ROBOTS_NOINDEX=$DM_ROBOTS_NOINDEX)"
  # The inverse assertion matters just as much: a production target that turned
  # the block off must not still be shipping noindex on its real pages.
  for p in "/" "/index.html" "/version.json" "/auth"; do
    h="$("${CURL[@]}" -D - -o /dev/null "$BASE$p" || true)"
    if printf '%s' "$h" | grep -qi '^x-robots-tag:.*noindex'; then
      fail "X-Robots-Tag: noindex still present on $p despite DM_ROBOTS_NOINDEX=$DM_ROBOTS_NOINDEX"
    else
      pass "no X-Robots-Tag: noindex on $p"
    fi
  done
  robots_code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/robots.txt" || echo 000)"
  if [ "$robots_code" = "200" ]; then
    robots="$("${CURL[@]}" "$BASE/robots.txt" || true)"
    case "$robots" in
      *"Disallow: /"*) fail "robots.txt still disallows everything despite DM_ROBOTS_NOINDEX=$DM_ROBOTS_NOINDEX" ;;
      *)               pass "robots.txt does not disallow everything" ;;
    esac
  else
    pass "no disallow-all robots.txt is served ($robots_code)"
  fi
fi

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
#
# Every instance logs one line per boot, so a single `tail -1` is not a verdict —
# it is a race. Under cluster mode instance 0 logs "registered" and instance 1
# logs "NOT registered", in nondeterministic order, which made this both flaky in
# the armed direction and UNSOUND in the off direction: a box that had wrongly
# armed cron still produces instance 1's "NOT registered" line, so whichever
# landed last decided the answer.
#
# So take the last DM_PM2_INSTANCES lines — exactly one boot's worth — and count
# how many actually registered. "Scheduled jobs registered" is matched in full
# because "NOT registered" contains "registered" as a substring. Bounding to one
# boot also stops a historical "registered" line, from before cron was turned off,
# reading as if it were current.
_cron_lines="$(grep -h 'Scheduled jobs' ~/.pm2/logs/${DM_PM2_APP}-out.log 2>/dev/null | tail -n "${DM_PM2_INSTANCES:-1}")"
echo "CRON_REGISTERED=$(printf '%s\n' "$_cron_lines" | grep -c 'Scheduled jobs registered' || true)"
echo "CRON_LOG=$(printf '%s\n' "$_cron_lines" | tail -1 | sed 's/.*Scheduled jobs/Scheduled jobs/')"

# Which database, by project ref only — never the credential.
#
# LAST assignment wins throughout, because that is what dotenv does when a key
# appears twice. Reading the first match would let this report a setting the app
# never uses — the bypass deploy/db-push.sh guard now refuses outright.
echo "DB_URL_LINES=$(grep -cE '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$DM_SHARED/.env" || true)"
echo "DB_USER=$(grep '^DATABASE_URL=' "$DM_SHARED/.env" | tail -1 | sed -E 's|^DATABASE_URL=postgresql://([^:]+):.*|\1|')"
echo "DB_HOST=$(grep '^DATABASE_URL=' "$DM_SHARED/.env" | tail -1 | sed -E 's|.*@([^:/]+).*|\1|')"
echo "STRIPE_LIVE=$(grep -vE '^[[:space:]]*#' "$DM_SHARED/.env" | grep -cE '=.*(sk|pk|rk)_live_' || true)"
echo "ENABLE_CRON=$(grep '^ENABLE_CRON=' "$DM_SHARED/.env" | tail -1 | cut -d= -f2-)"

# How email is configured, by the same three-way rule as server/lib/email.js:
# a key means live delivery, no key plus EMAIL_STUB=1 means log-only, and neither
# means every send throws. Derived from shared/.env rather than the boot log so it
# is checked even on a box that has not sent anything yet.
#
# NB: values are read with grep/cut, never by sourcing the file. WEEKLY_REPORT_FROM
# contains `<` and `>`, so a shell that sourced this would die on a redirection
# syntax error — the same trap release.sh avoids when exporting VITE_* vars.
echo "EMAIL_MODE=$(
  _k="$(grep '^RESEND_API_KEY=' "$DM_SHARED/.env" | tail -1 | cut -d= -f2-)"
  _s="$(grep '^EMAIL_STUB=' "$DM_SHARED/.env" | tail -1 | cut -d= -f2-)"
  if [ -n "$_k" ]; then echo live; elif [ "$_s" = "1" ]; then echo stub; else echo disabled; fi
)"
echo "APP_PUBLIC_URL=$(grep '^APP_PUBLIC_URL=' "$DM_SHARED/.env" | tail -1 | cut -d= -f2-)"
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

# Driven by the target's DM_EXPECT_CRON, which defaults to 0. A target that says
# nothing gets the strict "nothing is scheduled" assertion — this is the check
# that stops a non-production box emailing real parents and deleting children
# past their grace period, so it must not be skippable by omission.
# CRON_LOG is still emitted into the report above, where the operator can read
# the last "Scheduled jobs" line; nothing asserts on it since dca95f9 replaced
# the log-scraping check with the instance count below.
cron_registered="$(r CRON_REGISTERED)"
if cron_expected; then
  # Exactly one instance should schedule (instance 0), never more — more than one
  # would mean duplicate digests to real parents and concurrent orphan sweeps.
  check "exactly one instance registered scheduled jobs" "1" "$cron_registered"
  case "$(r ENABLE_CRON)" in
    1|true|yes|on) pass "shared/.env has ENABLE_CRON=$(r ENABLE_CRON)" ;;
    *)             fail "shared/.env ENABLE_CRON='$(r ENABLE_CRON)' — target expects cron ARMED" ;;
  esac
else
  check "no instance registered scheduled jobs" "0" "$cron_registered"
  case "$(r ENABLE_CRON)" in
    0|false|no|off) pass "shared/.env has ENABLE_CRON=$(r ENABLE_CRON)" ;;
    *)              fail "shared/.env ENABLE_CRON='$(r ENABLE_CRON)' — cron would be armed" ;;
  esac
fi

check "shared/.env assigns DATABASE_URL exactly once" "1" "$(r DB_URL_LINES)"
if [ -n "${DM_EXPECTED_DB_REF:-}" ]; then
  checkc "DATABASE_URL points at the expected project ($DM_EXPECTED_DB_REF)" \
    "$DM_EXPECTED_DB_REF" "$(r DB_USER)"
fi
# Email, asserted in both directions for the same reason as cron. On production a
# mode other than `live` means the weekly digest cannot deliver — and since
# server/lib/email.js now throws rather than silently stubbing, that shows up as
# rows piling into weekly_report_log with status 'failed' rather than as anything a
# visitor would notice. Anywhere else a `live` mode is worse: a real key on a test
# box mails REAL parents from a database full of test data, which is exactly what
# EMAIL_STUB=1 exists to prevent, and nothing else here was checking it.
if [ "${DM_ENVIRONMENT:-}" = "production" ]; then
  check "email is configured for live delivery" "live" "$(r EMAIL_MODE)"
else
  case "$(r EMAIL_MODE)" in
    live) fail "email mode is 'live' on non-production target '$DM_ENVIRONMENT' — it would mail real parents" ;;
    *)    pass "email does not deliver on this target ($(r EMAIL_MODE))" ;;
  esac
fi

# Live Stripe keys are correct on production and a defect anywhere else, so this
# follows the target like the robots and cron assertions above rather than
# hardcoding one environment's answer. Asserted in both directions: a production
# box with no live key means billing is silently disabled, which is worth a
# failure too — `verify.sh` is the gate that is supposed to notice.
if [ "${DM_ENVIRONMENT:-}" = "production" ]; then
  check "live Stripe key present (expected on production)" "1" "$(r STRIPE_LIVE)"
else
  check "no live Stripe key on the box" "0" "$(r STRIPE_LIVE)"
fi
check "APP_PUBLIC_URL is this host" "https://$DM_HOSTNAME" "$(r APP_PUBLIC_URL)"

# Every worker must be running the release `current` points at.
active="$(r CURRENT)"
worker_cwds="$(printf '%s' "$remote_report" | grep '^WORKER_CWD=' | cut -d= -f2- | sort -u)"
if [ -z "$worker_cwds" ]; then
  fail "no running workers found for $DM_PM2_APP"
elif [ "$(printf '%s\n' "$worker_cwds" | awk 'END{print NR}')" = "1" ] && [ "$worker_cwds" = "$active" ]; then
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
