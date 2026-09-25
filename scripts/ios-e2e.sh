#!/bin/bash
# npm run ios:e2e — the iOS end-to-end suite (#128) against a real local server.
#
#   1. makes a throwaway local Postgres database and pushes server/db/schema.js
#      into it (drizzle-kit, the same push production uses);
#   2. starts the API on it (loopback, a port of its own, mail stubbed, no cron);
#   3. signs a parent up and adds a child through the API itself;
#   4. runs the end-to-end XCUITests (DragonAcademyUITests/EndToEndSyncUITests)
#      with the server's URL, the parent's session and the child's id;
#   5. checks the database: the win arrived through POST /api/sync/events and
#      was applied;
#   6. stops the server and drops the database, pass or fail.
#
# Knobs (environment):
#   E2E_DESTINATION   xcodebuild -destination (default: iPhone 18 Pro simulator)
#   E2E_DERIVED_DATA  -derivedDataPath (default: ios/build/DerivedData)
#   E2E_PORT          API port (default 3137)
#   E2E_DB            database name (default dragon_math_e2e); it is DROPPED
#                     and recreated, so never point it at a database you need
#   E2E_XCODEBUILD_ARGS  extra xcodebuild arguments (e.g. "-jobs 6")
#   E2E_KEEP=1        leave the server's log and the database behind
#   PG* variables     where the local Postgres is (psql/createdb defaults)
#
# Never touches production: the database URL is built here from the local
# Postgres, and it overrides any DATABASE_URL in .env (dotenv doesn't replace
# variables that are already set, which is also why the keys below are set
# empty rather than left unset).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DB=${E2E_DB:-dragon_math_e2e}
PORT=${E2E_PORT:-3137}
DEST=${E2E_DESTINATION:-platform=iOS Simulator,name=iPhone 18 Pro}
DERIVED=${E2E_DERIVED_DATA:-$ROOT/ios/build/DerivedData}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ios-e2e.XXXXXX")
SERVER_LOG=$WORK/server.log
TEST_LOG=$WORK/xcodebuild.log
BASE=http://localhost:$PORT

case $DB in
  *[!a-z0-9_]*) echo "E2E_DB must be a plain lower-case name" >&2; exit 2 ;;
esac

server_pid=
xcode_pid=
cleanup() {
  status=$?
  [ -n "$xcode_pid" ] && kill "$xcode_pid" 2>/dev/null || true
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  if [ "${E2E_KEEP:-}" = 1 ]; then
    echo "Kept database $DB and logs in $WORK"
  else
    dropdb --if-exists "$DB" >/dev/null 2>&1 || true
    # A failed run's logs stay for a look.
    if [ $status -eq 0 ]; then rm -rf "$WORK"; else echo "Logs in $WORK"; fi
  fi
  exit $status
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "== Database $DB"
dropdb --if-exists "$DB" 2>/dev/null || true
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c 'CREATE EXTENSION IF NOT EXISTS citext'
DATABASE_URL="postgres://${PGUSER:-$(whoami)}@${PGHOST:-localhost}:${PGPORT:-5432}/$DB"
(cd "$ROOT" && DATABASE_URL=$DATABASE_URL npx drizzle-kit push --force --config drizzle.config.cjs >"$WORK/push.log" 2>&1) \
  || { cat "$WORK/push.log"; exit 1; }

echo "== Server on $BASE"
(
  cd "$ROOT"
  exec env DATABASE_URL="$DATABASE_URL" API_PORT="$PORT" API_HOST=127.0.0.1 \
    JWT_SECRET="e2e-$(openssl rand -hex 16)" \
    ENABLE_CRON=0 EMAIL_STUB=1 RESEND_API_KEY= STRIPE_SECRET_KEY= ANTHROPIC_API_KEY= \
    ELEVENLABS_API_KEY= APPSTORE_BUNDLE_ID= GOOGLE_OAUTH_CLIENT_ID= APPLE_CLIENT_IDS= \
    node server/index.js
) >"$SERVER_LOG" 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$SERVER_LOG"; exit 1; }
  sleep 0.5
done
curl -fsS "$BASE/api/health" >/dev/null || { echo "server never came up"; cat "$SERVER_LOG"; exit 1; }

echo "== Parent and child"
# json <a.b.c>: that field of the JSON on stdin.
json() {
  node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const v = process.argv[1].split(".").reduce((o, k) => o?.[k], JSON.parse(s));
    if (v === undefined) process.exit(1);
    console.log(v);
  })' "$1"
}
signup=$(curl -fsS -X POST "$BASE/api/auth/parent/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"e2e-$(date +%s)@example.test\",\"password\":\"e2e-$(openssl rand -hex 8)\"}")
PARENT_TOKEN=$(printf '%s' "$signup" | json token)
child=$(curl -fsS -X POST "$BASE/api/parent/children" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PARENT_TOKEN" -d '{"real_name":"Ada Lovelace"}')
CHILD_ID=$(printf '%s' "$child" | json child.id)
echo "child $CHILD_ID"

echo "== XCUITests (log: $TEST_LOG)"
cd "$ROOT/ios"
# xcodebuild hands TEST_RUNNER_-prefixed variables to the test runner.
# Extra xcodebuild flags, split on spaces (macOS bash 3.2 with set -u: guard the empty array).
read -r -a EXTRA_ARGS <<< "${E2E_XCODEBUILD_ARGS:-}"
TEST_RUNNER_DA_E2E_API=$BASE TEST_RUNNER_DA_E2E_PARENT_TOKEN=$PARENT_TOKEN TEST_RUNNER_DA_E2E_CHILD_ID=$CHILD_ID \
  xcodebuild -skipPackagePluginValidation -scheme DragonAcademy -destination "$DEST" \
    -derivedDataPath "$DERIVED" -parallel-testing-enabled NO \
    -test-timeouts-enabled YES -default-test-execution-time-allowance 300 \
    -collect-test-diagnostics never ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
    -only-testing:DragonAcademyUITests/EndToEndSyncUITests test >"$TEST_LOG" 2>&1 &
xcode_pid=$!
# A beta Xcode can go quiet for good; give up after 10 idle minutes.
last=$(date +%s); size=0
while kill -0 "$xcode_pid" 2>/dev/null; do
  sleep 10
  s=$(stat -f %z "$TEST_LOG" 2>/dev/null || stat -c %s "$TEST_LOG")
  if [ "$s" != "$size" ]; then size=$s; last=$(date +%s); fi
  if [ $(( $(date +%s) - last )) -gt 600 ]; then echo "xcodebuild idle for 10 minutes; stopping it"; break; fi
done
rc=0
if kill -0 "$xcode_pid" 2>/dev/null; then
  kill "$xcode_pid"; rc=124
else
  wait "$xcode_pid" || rc=$?
fi
xcode_pid=
grep -E "Test Case .*(passed|failed|skipped)|error:|\*\* TEST" "$TEST_LOG" | tail -20 || true
if [ $rc -ne 0 ] || grep -q "skipped" <(grep "Test Case" "$TEST_LOG"); then
  echo "FAIL: the end-to-end UI test did not pass (rc=$rc)"
  exit 1
fi

echo "== Server side"
row=$(psql -At -d "$DB" -c "SELECT
  (SELECT count(*) FROM sync_events WHERE user_id = $CHILD_ID AND kind = 'node_won' AND applied),
  (SELECT count(*) FROM node_progress WHERE user_id = $CHILD_ID AND node_id = 1 AND completed)")
echo "applied node_won events | node 1 completed: $row"
if [ "$row" != "1|1" ]; then echo "FAIL: the win isn't in the database"; exit 1; fi
echo "PASS"
