#!/usr/bin/env bash
# End-to-end smoke test of the Compose stack: build images, start everything, create an admin
# and a device, publish one MQTT message and read it back through the API, render a report, check
# Prometheus, and back up and restore.
# Usage: deploy/test/compose-smoke.sh   (run from anywhere; needs docker and python3)
# KEEP_STACK=1 leaves the stack running; SMOKE_OUT=<dir> keeps the rendered report PDF.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="perspice-smoke"
OWNER="local"
VERSION="smoke"
BASE="https://localhost:18443"
WORK="$(mktemp -d)"
ENV_FILE="$WORK/.env"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml" -f "$ROOT/deploy/test/smoke.override.yml" --profile monitoring)

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nSMOKE FAILED: %s\n' "$*" >&2; "${COMPOSE[@]}" logs --tail 40 api ingest emqx caddy renderer >&2 || true; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

cleanup() {
  if [[ "${KEEP_STACK:-}" != "1" ]]; then "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

log "Building images"
docker build -q -f "$ROOT/deploy/Dockerfile.server" -t "ghcr.io/$OWNER/perspice-server:$VERSION" "$ROOT" >/dev/null
docker build -q -f "$ROOT/deploy/Dockerfile.web" -t "ghcr.io/$OWNER/perspice-web:$VERSION" "$ROOT" >/dev/null
docker build -q -f "$ROOT/deploy/Dockerfile.renderer" -t "ghcr.io/$OWNER/perspice-renderer:$VERSION" "$ROOT" >/dev/null

secret() { openssl rand -base64 "$1" | tr -d '\n=/+' ; }
cat >"$ENV_FILE" <<ENV
PERSPICE_VERSION=$VERSION
PERSPICE_IMAGE_OWNER=$OWNER
BASE_DOMAIN=localhost
PUBLIC_URL=$BASE
ACME_EMAIL=smoke@perspice.test
POSTGRES_PASSWORD=$(secret 24)
JWT_SECRET=$(secret 48)
MASTER_KEY=$(openssl rand -base64 32)
INTERNAL_SECRET=$(secret 24)
MQTT_INGEST_PASSWORD=$(secret 24)
EMQX_API_KEY=perspice
EMQX_API_SECRET=$(secret 24)
EMQX_DASHBOARD_PASSWORD=$(secret 24)
MQTT_PLAIN_ENABLED=true
BACKUP_PASSPHRASE=$(secret 32)
ENV

log "Starting the stack"
if ! "${COMPOSE[@]}" up -d --build --quiet-pull >"$WORK/up.log" 2>&1; then
  tail -n 30 "$WORK/up.log" >&2
  fail "docker compose up"
fi

log "Waiting for $BASE/health"
for _ in $(seq 1 90); do
  curl -fsSk "$BASE/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsSk "$BASE/health" || fail "health endpoint not reachable within 180 s"

log "Creating the super admin"
out="$("${COMPOSE[@]}" exec -T api node dist/cli.js create-admin --email smoke@perspice.test --name Smoke)" || fail "create-admin"
token="$(grep -o 'token=[A-Za-z0-9_-]*' <<<"$out" | head -n1 | cut -d= -f2)"
[[ -n "$token" ]] || fail "no activation link in: $out"
api() { curl -fsSk -H 'content-type: application/json' "$@"; }
api -X POST "$BASE/api/auth/activate" -d "{\"token\":\"$token\",\"password\":\"smoke-password-123\"}" >/dev/null || fail "activate"
access="$(api -X POST "$BASE/api/auth/login" -d '{"email":"smoke@perspice.test","password":"smoke-password-123"}' | json "d['accessToken']")"

log "Enrolling two-factor authentication"
totp_secret="$(api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/setup" | json "d['secret']")"
code="$("${COMPOSE[@]}" exec -T api node -e "process.stdout.write(require('otplib').generateSync({secret:'$totp_secret'}))")"
api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/enable" -d "{\"code\":\"$code\"}" >/dev/null || fail "totp enable"

log "Creating a device"
auth=(-H "authorization: Bearer $access")
profile="$(api "${auth[@]}" "$BASE/api/device-profiles" | json "[p['id'] for p in d if p['name']=='Generic Sensor'][0]")"
created="$(api "${auth[@]}" -X POST "$BASE/api/devices" -d "{\"name\":\"smoke-1\",\"profileId\":\"$profile\"}")"
device_id="$(json "d['device']['id']" <<<"$created")"
device_token="$(json "d['token']" <<<"$created")"

log "Adding an alarm rule"
api "${auth[@]}" -X POST "$BASE/api/alarm-rules" -d "{\"name\":\"Hot\",\"severity\":\"major\",\"scope\":{\"kind\":\"profile\",\"profileId\":\"$profile\"},\"type\":\"threshold\",\"condition\":{\"key\":\"temperature\",\"op\":\">\",\"value\":20}}" >/dev/null || fail "alarm rule"

log "Publishing telemetry over MQTT"
docker run --rm --network "${PROJECT}_default" eclipse-mosquitto:2 \
  mosquitto_pub -h emqx -p 1883 -q 1 -i "$device_id" -u "$device_id" -P "$device_token" \
  -t "perspice/v1/$device_id/telemetry" -m '{"values":{"temperature":21.5}}' || fail "mosquitto_pub"

log "Reading it back"
for _ in $(seq 1 20); do
  latest="$(api "${auth[@]}" "$BASE/api/devices/$device_id/telemetry/latest" || true)"
  [[ "$latest" == *'"temperature"'* ]] && break
  sleep 0.5
done
[[ "$latest" == *'"v":21.5'* ]] || fail "telemetry not stored: $latest"

log "Checking the alarm fired"
for _ in $(seq 1 20); do
  alarms="$(api "${auth[@]}" "$BASE/api/alarms?status=active" || true)"
  [[ "$alarms" == *'"ruleName":"Hot"'* ]] && break
  sleep 0.5
done
[[ "$alarms" == *'"ruleName":"Hot"'* ]] || fail "no alarm: $alarms"

log "Rendering the device dashboard to PDF"
job="$(api "${auth[@]}" -X POST "$BASE/api/reports/dashboard" -d "{\"deviceId\":\"$device_id\",\"timewindow\":{\"kind\":\"relative\",\"lastMs\":3600000}}" | json "d['id']")" || fail "report request"
for _ in $(seq 1 60); do
  status="$(api "${auth[@]}" "$BASE/api/exports/$job" | json "d['status']")"
  [[ "$status" == "done" || "$status" == "failed" ]] && break
  sleep 2
done
[[ "$status" == "done" ]] || fail "report $status: $(api "${auth[@]}" "$BASE/api/exports/$job")"
url="$(api "${auth[@]}" "$BASE/api/exports/$job" | json "d['downloadUrl']")"
curl -fsSk -o "$WORK/report.pdf" "$BASE$url" || fail "report download"
[[ "$(head -c 5 "$WORK/report.pdf")" == "%PDF-" ]] || fail "report is not a PDF"
if [[ -n "${SMOKE_OUT:-}" ]]; then cp "$WORK/report.pdf" "$SMOKE_OUT/"; fi

log "Checking Prometheus scrapes every process"
targets=""
for _ in $(seq 1 30); do
  targets="$("${COMPOSE[@]}" exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active' || true)"
  up="$(python3 -c "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sorted({x['labels']['service'] for x in t if x['labels']['job']=='perspice' and x['health']=='up'}))" <<<"$targets" 2>/dev/null || true)"
  [[ "$up" == "['api', 'ingest', 'renderer', 'rules', 'scheduler']" ]] && break
  sleep 3
done
[[ "$up" == "['api', 'ingest', 'renderer', 'rules', 'scheduler']" ]] || fail "Prometheus targets: $up"

log "Backing up, deleting the device and restoring the backup"
"${COMPOSE[@]}" exec -T api node dist/cli.js backup --out - >"$WORK/backup.pbk" || fail "backup"
[[ "$(head -c 6 "$WORK/backup.pbk")" == "PSPBK1" ]] || fail "backup is not a Perspice backup"
api "${auth[@]}" -X DELETE "$BASE/api/devices/$device_id" >/dev/null || fail "delete device"
"${COMPOSE[@]}" exec -T api node dist/cli.js restore - <"$WORK/backup.pbk" || fail "restore"
api "${auth[@]}" "$BASE/api/devices/$device_id" | grep -q '"name":"smoke-1"' || fail "device not back after restore"
latest="$(api "${auth[@]}" "$BASE/api/devices/$device_id/telemetry/latest")"
[[ "$latest" == *'"v":21.5'* ]] || fail "telemetry not restored: $latest"

echo "SMOKE OK"
