#!/usr/bin/env bash
# Load test (success criterion 8, docs/load-test.md): the stack on 4 shared cores and 8 GB, 10,000
# simulated MQTT devices sending one message every 10 s for 15 minutes. Passes when the sustained
# rate is at least 99% of the offered rate, every message sent is stored, and p95 latency from
# publish to the realtime API is under 2 s.
# Usage: deploy/test/loadtest.sh   (needs docker, node, python3 and at least 6 cores; run from anywhere)
#   LOAD_COUNT=10000 LOAD_DURATION=900 LOAD_INTERVAL=10   the load (defaults shown)
#   LOAD_MOBILE_SHARE=0.1   this fraction of devices drive around reporting positions (locations
#                           and trips switched on for the profile)
#   LOAD_OUT=<dir>   where the summary, per-minute report and container stats go (default: a temp dir)
#   SKIP_BUILD=1     reuse images built by an earlier run; KEEP_STACK=1 leaves the stack running
#   LOAD_OVERRIDE=<file>  one more compose override (e.g. to profile a service)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="perspice-load"
OWNER="local"
VERSION="smoke"
BASE="https://localhost:18443"
COUNT="${LOAD_COUNT:-10000}"
DURATION="${LOAD_DURATION:-900}"
INTERVAL="${LOAD_INTERVAL:-10}"
WORK="$(mktemp -d)"
OUT="${LOAD_OUT:-$WORK/out}"
mkdir -p "$OUT"
ENV_FILE="$WORK/.env"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml"
  -f "$ROOT/deploy/test/smoke.override.yml" -f "$ROOT/deploy/test/loadtest.override.yml" ${LOAD_OVERRIDE:+-f "$LOAD_OVERRIDE"})

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nLOAD TEST FAILED: %s\n' "$*" >&2; "${COMPOSE[@]}" logs --tail 30 migrate api ingest emqx >&2 || true; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
psql() { "${COMPOSE[@]}" exec -T postgres psql -U perspice -d perspice -tAc "$1"; }

stats_pid=""
cleanup() {
  if [[ -n "$stats_pid" ]]; then kill "$stats_pid" 2>/dev/null || true; fi
  if [[ "${KEEP_STACK:-}" != "1" ]]; then "${COMPOSE[@]}" --profile reports down -v --remove-orphans >/dev/null 2>&1 || true; fi
  [[ -n "${LOAD_OUT:-}" ]] || printf 'Results were in %s (removed)\n' "$OUT"
  rm -rf "$WORK"
}
trap cleanup EXIT

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "Building images"
  docker build -q -f "$ROOT/deploy/Dockerfile.server" -t "ghcr.io/$OWNER/perspice-server:$VERSION" "$ROOT" >/dev/null
  docker build -q -f "$ROOT/deploy/Dockerfile.web" -t "ghcr.io/$OWNER/perspice-web:$VERSION" "$ROOT" >/dev/null
fi
log "Building the simulator"
(cd "$ROOT" && corepack pnpm --filter @perspice/shared build >/dev/null && corepack pnpm --filter @perspice/simulator build >/dev/null)

secret() { openssl rand -base64 "$1" | tr -d '\n=/+'; }
cat >"$ENV_FILE" <<ENV
PERSPICE_VERSION=$VERSION
PERSPICE_IMAGE_OWNER=$OWNER
BASE_DOMAIN=localhost
PUBLIC_URL=$BASE
ACME_EMAIL=load@perspice.test
POSTGRES_PASSWORD=$(secret 24)
JWT_SECRET=$(secret 48)
MASTER_KEY=$(openssl rand -base64 32)
INTERNAL_SECRET=$(secret 24)
MQTT_INGEST_PASSWORD=$(secret 24)
EMQX_API_KEY=perspice
EMQX_API_SECRET=$(secret 24)
EMQX_DASHBOARD_PASSWORD=$(secret 24)
MQTT_PLAIN_ENABLED=true
LOG_LEVEL=warn
ENV

(($(nproc) >= 6)) || fail "needs at least 6 cores: 4 for the stack, the rest for the simulator"
log "Starting the stack (cores 0-3, 8 GB)"
"${COMPOSE[@]}" up -d --quiet-pull >"$WORK/up.log" 2>&1 || { tail -n 30 "$WORK/up.log" >&2; fail "docker compose up"; }
for _ in $(seq 1 90); do
  curl -fsSk "$BASE/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsSk "$BASE/health" >/dev/null || fail "health endpoint not reachable within 180 s"

log "Signing in and creating an API key for the simulator"
out="$("${COMPOSE[@]}" exec -T api node dist/cli.js create-admin --email load@perspice.test --name Load)" || fail "create-admin"
token="$(grep -o 'token=[A-Za-z0-9_-]*' <<<"$out" | head -n1 | cut -d= -f2)"
api() { curl -fsSk -H 'content-type: application/json' "$@"; }
api -X POST "$BASE/api/auth/activate" -d "{\"token\":\"$token\",\"password\":\"load-password-123\"}" >/dev/null || fail "activate"
access="$(api -X POST "$BASE/api/auth/login" -d '{"email":"load@perspice.test","password":"load-password-123"}' | json "d['accessToken']")"
totp_secret="$(api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/setup" | json "d['secret']")"
code="$("${COMPOSE[@]}" exec -T api node -e "process.stdout.write(require('otplib').generateSync({secret:'$totp_secret'}))")"
api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/enable" -d "{\"code\":\"$code\"}" >/dev/null || fail "totp enable"
key="$(api -X POST -H "authorization: Bearer $access" "$BASE/api/api-keys" \
  -d '{"name":"load test","permissions":["device.read","device.write","profile.read","telemetry.read"]}' | json "d['key']")"
MOBILE_SHARE="${LOAD_MOBILE_SHARE:-0}"
if [[ "$MOBILE_SHARE" != "0" ]]; then
  profile_id="$(api -H "authorization: Bearer $access" "$BASE/api/device-profiles" | json "[p['id'] for p in d if p['name']=='Generic Sensor'][0]")"
  api -X PATCH -H "authorization: Bearer $access" "$BASE/api/device-profiles/$profile_id" \
    -d '{"locationMode":"reported","trips":{"enabled":true}}' >/dev/null || fail "enable locations on the profile"
fi

# Devices connect to EMQX's container address: through the published port, Docker's userland
# proxy would spend CPU outside the stack's cores on every connection.
emqx_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$("${COMPOSE[@]}" ps -q emqx)")"

log "Recording container usage every 10 s"
(
  while true; do
    docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' | grep "^$PROJECT-" | sed "s/^/$(date +%s)\t/"
    sleep 10
  done
) >"$OUT/stats.tsv" 2>/dev/null &
stats_pid=$!

min_rate="$(python3 -c "print(round($COUNT / $INTERVAL * 0.99, 1))")"
log "Simulating $COUNT devices ($MOBILE_SHARE mobile), one message every $INTERVAL s for $DURATION s (pass: ≥ $min_rate msg/s, p95 < 2 s, no loss)"
sim_status=0
# The simulator stays off the stack's cores.
taskset -c "4-$(($(nproc) - 1))" node "$ROOT/apps/simulator/dist/index.js" --url "$BASE" --mqtt "mqtt://$emqx_ip:1883" --api-key "$key" --insecure \
  --profile "Generic Sensor" --create --devices-file "$WORK/devices.json" --count "$COUNT" --interval "$INTERVAL" \
  --duration "$DURATION" --measure-latency --max-p95-ms 2000 --min-rate "$min_rate" --summary "$OUT/summary.json" \
  --mobile-share "$MOBILE_SHARE" \
  | tee "$OUT/simulator.log" || sim_status=$?
[[ -s "$OUT/summary.json" ]] || fail "the simulator produced no summary"

log "Counting stored messages"
started="$(json "d['startedAt']" <"$OUT/summary.json")"
ended="$(json "d['endedAt']" <"$OUT/summary.json")"
sent="$(json "d['sent']" <"$OUT/summary.json")"
query="SELECT count(*) FROM (SELECT DISTINCT device_id, ts FROM telemetry WHERE ts >= to_timestamp($started / 1000.0) AND ts <= to_timestamp($ended / 1000.0)) m"
stored=0
for _ in $(seq 1 24); do
  stored="$(psql "$query")"
  [[ "$stored" -ge "$sent" ]] && break
  sleep 5 # ingest may still be draining
done
lost=$((sent - stored))

kill "$stats_pid" 2>/dev/null || true
stats_pid=""
python3 - "$OUT/stats.tsv" "$started" "$ended" >"$OUT/stats-peak.txt" <<'PY'
import sys, re
# Only samples taken while messages were being sent.
start, end = int(sys.argv[2]) / 1000, int(sys.argv[3]) / 1000
peak = {}
total = {}
units = {'B': 1, 'KiB': 2**10, 'MiB': 2**20, 'GiB': 2**30}
for line in open(sys.argv[1]):
    parts = line.rstrip('\n').split('\t')
    if len(parts) != 4: continue
    at, name, cpu, mem = parts
    if not start <= int(at) <= end: continue
    m = re.match(r'([\d.]+)(\w+)', mem.split('/')[0].strip())
    used = float(m.group(1)) * units.get(m.group(2), 1) if m else 0
    c = float(cpu.rstrip('%') or 0)
    total[parts[0]] = total.get(parts[0], 0) + c
    p = peak.setdefault(name, [0.0, 0.0])
    p[0], p[1] = max(p[0], c), max(p[1], used)
for name, (c, m) in sorted(peak.items()):
    print(f"{name:32} peak CPU {c:6.1f}%   peak memory {m / 2**20:7.0f} MiB")
print(f"{'whole stack (4 cores = 400%)':32} peak CPU {max(total.values(), default=0):6.1f}%   average {sum(total.values()) / max(1, len(total)):6.1f}%")
PY

log "Results"
python3 - "$OUT/summary.json" "$stored" "$lost" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
l = s['latencyMs']
print(f"devices          {s['devices']} (connected in {s['connectS']} s)")
print(f"sent             {s['sent']} in {s['durationS']} s = {s['messagesPerSecond']} msg/s, {s['errors']} errors")
print(f"stored           {sys.argv[2]} (lost {sys.argv[3]})")
print(f"latency          p50 {l['p50']} ms, p95 {l['p95']} ms, p99 {l['p99']} ms, max {l['max']} ms ({l['samples']} samples)")
print("per minute       " + ", ".join(f"{m['messagesPerSecond']}" for m in s['perMinute']) + " msg/s")
PY
cat "$OUT/stats-peak.txt"
printf 'host             %s, %s vCPU, %s GB RAM, Docker %s\n' "$(sed -n 's/^PRETTY_NAME="\(.*\)"/\1/p' /etc/os-release)" "$(nproc)" \
  "$(awk '/MemTotal/ { print int($2 / 1024 / 1024) }' /proc/meminfo)" "$(docker version --format '{{.Server.Version}}')"

[[ "$lost" -le 0 ]] || fail "$lost messages were not stored"
[[ "$sim_status" -eq 0 ]] || fail "the simulator's checks failed (see above)"
echo "LOAD TEST OK"
