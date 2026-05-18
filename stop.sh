#!/usr/bin/env bash
# Stop any running Dragon Math dev processes (vite, API server, concurrently).
set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT="${API_PORT:-3001}"
VITE_PORT="${VITE_PORT:-5173}"

killed_any=0

kill_pids() {
  local label="$1"; shift
  local pids=("$@")
  [ ${#pids[@]} -eq 0 ] && return
  echo "Stopping $label: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true
  sleep 1
  local stragglers=()
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null && stragglers+=("$pid")
  done
  if [ ${#stragglers[@]} -gt 0 ]; then
    echo "Force killing $label: ${stragglers[*]}"
    kill -9 "${stragglers[@]}" 2>/dev/null || true
  fi
  killed_any=1
}

# Processes listening on the API and Vite ports.
for port in "$API_PORT" "$VITE_PORT"; do
  mapfile -t pids < <(lsof -ti tcp:"$port" 2>/dev/null)
  [ ${#pids[@]} -gt 0 ] && kill_pids "port $port" "${pids[@]}"
done

# Processes started from this repo (concurrently / vite / node server/index.js).
mapfile -t pids < <(pgrep -f "$REPO_DIR/(server/index\.js|node_modules/\.bin/(vite|concurrently))" 2>/dev/null)
[ ${#pids[@]} -gt 0 ] && kill_pids "dragon-math processes" "${pids[@]}"

# PM2 process (if registered and not already stopped).
if command -v pm2 >/dev/null 2>&1; then
  status="$(pm2 jlist 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      try{const a=JSON.parse(d);const p=a.find(x=>x.name==='dragonmath-api');
      console.log(p?p.pm2_env.status:'missing')}catch{console.log('missing')}
    })" 2>/dev/null)"
  if [ "$status" = "online" ]; then
    echo "Stopping pm2 dragonmath-api"
    pm2 stop dragonmath-api >/dev/null
    killed_any=1
  elif [ "$status" = "stopped" ]; then
    echo "pm2 dragonmath-api already stopped."
  fi
fi

if [ "$killed_any" -eq 0 ]; then
  echo "No Dragon Math processes found."
fi
