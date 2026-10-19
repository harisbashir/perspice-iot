#!/usr/bin/env bash
# Runs inside the install-e2e container (see install-e2e.sh): /work holds the release tarballs.
set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf '\nINSTALL E2E FAILED: %s\n' "$*" >&2
  # The logs that explain most failures.
  for svc in api emqx ingest; do
    printf '\n--- %s (last 40 lines) ---\n' "$svc" >&2
    docker compose -p perspice -f /opt/perspice/docker-compose.yml --env-file /opt/perspice/.env logs --tail 40 "$svc" >&2 2>/dev/null || true
  done
  exit 1
}
# DOMAIN (default localhost) may be an IPv4 address: the installer then serves its sslip.io name.
DOMAIN="${DOMAIN:-localhost}"
HOST="$DOMAIN"
[[ "$DOMAIN" =~ ^[0-9.]+$ ]] && HOST="${DOMAIN//./-}.sslip.io"
BASE="https://$HOST"
api() { curl -fsSk -H 'content-type: application/json' "$@"; }
COMPOSE=(docker compose -p perspice -f /opt/perspice/docker-compose.yml --env-file /opt/perspice/.env)
version() { sed -n 's/^PERSPICE_VERSION=//p' /opt/perspice/.env; }

log "Starting Docker"
# Delegate cgroup v2 controllers to the inner daemon (as the official docker:dind image does), so
# its containers see their memory limits like on a real host.
if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 </sys/fs/cgroup/cgroup.procs >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  sed -e 's/ / +/g' -e 's/^/+/' </sys/fs/cgroup/cgroup.controllers >/sys/fs/cgroup/cgroup.subtree_control || true
fi
dockerd >/var/log/dockerd.log 2>&1 &
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker info >/dev/null 2>&1 || fail "dockerd did not start"
mkdir -p /opt/src
tar -xzf /work/from.tar.gz -C /opt/src
tar -xzf /work/current.tar.gz -C /opt/src
NEW="$(tr -d '[:space:]' </opt/src/new/VERSION)"
# The version of the tree being installed first (--from HEAD installs this checkout itself).
FROM="$(tr -d '[:space:]' </opt/src/old/VERSION)"
FRESH=0
[[ "$FROM" == "$NEW" ]] && FRESH=1

log "Installing $FROM with its own install.sh (images built from its source)"
old_install() { bash /opt/src/old/scripts/install.sh --build --non-interactive --domain "$DOMAIN" --admin-email admin@perspice.test --version "$FROM" 2>&1 | tee /work/install.log; }
# A first database boot in a nested container is slow, and before 1.0 the healthcheck could call
# its initialisation ready, so the old installer's migration sometimes failed. Its --reinstall
# can't recover (it replaced the database password; fixed in 1.0), so start over, as a user would
# after a failed first install.
if ! old_install; then
  # Only older installers get a second chance: the current one must work the first time.
  [[ "$FRESH" == "1" ]] && fail "the install of this checkout failed"
  log "The $FROM install failed; removing it and installing again"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f /opt/perspice/.env
  old_install || fail "install of $FROM failed twice"
fi
[[ "$(version)" == "$FROM" ]] || fail "installed version is $(version)"
for _ in $(seq 1 60); do api "$BASE/health" >/dev/null 2>&1 && break; sleep 2; done
api "$BASE/health" >/dev/null || fail "health endpoint not reachable after install"

log "Activating the super admin and enrolling two-factor authentication"
token="$(grep -o 'token=[A-Za-z0-9_-]*' /work/install.log | head -n1 | cut -d= -f2)"
[[ -n "$token" ]] || fail "no activation link in the install output"
api -X POST "$BASE/api/auth/activate" -d "{\"token\":\"$token\",\"password\":\"install-password-123\"}" >/dev/null || fail "activate"
access="$(api -X POST "$BASE/api/auth/login" -d '{"email":"admin@perspice.test","password":"install-password-123"}' | jq -r .accessToken)"
secret="$(api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/setup" | jq -r .secret)"
totp() { "${COMPOSE[@]}" exec -T api node -e "process.stdout.write(require('otplib').generateSync({secret:'$secret'}))"; }
api -X POST -H "authorization: Bearer $access" "$BASE/api/auth/totp/enable" -d "{\"code\":\"$(totp)\"}" >/dev/null || fail "totp enable"
login() {
  sleep 1
  api -X POST "$BASE/api/auth/login" -d "{\"email\":\"admin@perspice.test\",\"password\":\"install-password-123\",\"totp\":\"$(totp)\"}" | jq -r .accessToken
}

log "Adding a customer and a device, and sending telemetry over MQTT"
auth=(-H "authorization: Bearer $access")
customer="$(api "${auth[@]}" -X POST "$BASE/api/customers" -d '{"name":"Upgrade Co","slug":"upgrade"}' | jq -r .id)"
if [[ "$HOST" != "$DOMAIN" ]]; then
  log "Checking the IP install: the sslip.io name, local certificates and the redirect from the IP"
  issuer="$(echo | openssl s_client -connect "$DOMAIN:443" -servername "upgrade.$HOST" 2>/dev/null | openssl x509 -noout -issuer)"
  [[ "$issuer" == *"Caddy Local Authority"* ]] || fail "the customer's certificate came from: $issuer"
  location="$(curl -sI "http://$DOMAIN/devices" | sed -n 's/^[Ll]ocation: *//p' | tr -d '\r')"
  [[ "$location" == "https://$HOST/devices" ]] || fail "http://$DOMAIN redirects to '$location'"
fi
profile="$(api "${auth[@]}" "$BASE/api/device-profiles" | jq -r '[.[] | select(.name == "Generic Sensor")][0].id')"
created="$(api "${auth[@]}" -X POST "$BASE/api/devices" -d "{\"name\":\"survivor\",\"profileId\":\"$profile\",\"customerId\":\"$customer\"}")"
device="$(jq -r .device.id <<<"$created")"
device_token="$(jq -r .token <<<"$created")"
publish() { mosquitto_pub -h localhost -p 1883 -q 1 -i "$device" -u "$device" -P "$device_token" -t "perspice/v1/$device/telemetry" -m "{\"values\":{\"temperature\":$1}}"; }
latest_temp() { api -H "authorization: Bearer $1" "$BASE/api/devices/$device/telemetry/latest" | jq -r '.temperature.v // empty'; }
if [[ "$FRESH" == "1" ]]; then
  # The current installer only reports success once devices can connect.
  publish 21.5 || fail "a device couldn't publish right after the install finished"
else
  # Installers before 1.0 restarted the API at the very end, so the broker may refuse devices for
  # up to a minute after they finish.
  for _ in $(seq 1 24); do publish 21.5 2>/dev/null && break; sleep 5; done
  publish 21.5 || fail "publish before the update"
fi
for _ in $(seq 1 20); do [[ "$(latest_temp "$access")" == "21.5" ]] && break; sleep 0.5; done
[[ "$(latest_temp "$access")" == "21.5" ]] || fail "telemetry not stored before the update"
LAST_TEMP=21.5

if [[ "$FRESH" == "1" ]]; then
  log "Fresh install of $NEW: no upgrade to run"
  access="$(login)"
  auth=(-H "authorization: Bearer $access")
else
log "Updating $FROM → $NEW with update.sh --source"
# Installs before 1.0 have an update.sh without --source: the new release's updater does it.
bash /opt/src/new/scripts/update.sh --yes --source /opt/src/new 2>&1 | tee /work/update.log
[[ "$(version)" == "$NEW" ]] || fail "version after the update is $(version)"
grep -q 'Perspice .* is running' /work/update.log || fail "update did not report success"

log "Checking the data survived and the new version works"
access="$(login)"
auth=(-H "authorization: Bearer $access")
[[ "$(api "${auth[@]}" "$BASE/api/devices/$device" | jq -r .name)" == "survivor" ]] || fail "device lost in the update"
[[ "$(latest_temp "$access")" == "21.5" ]] || fail "telemetry lost in the update"
publish 22.5 || fail "publish after the update (the old device token)"
for _ in $(seq 1 20); do [[ "$(latest_temp "$access")" == "22.5" ]] && break; sleep 0.5; done
[[ "$(latest_temp "$access")" == "22.5" ]] || fail "telemetry not stored after the update"
LAST_TEMP=22.5
api "${auth[@]}" "$BASE/api/asset-types" >/dev/null || fail "a v0.8 endpoint is missing after the update"
"${COMPOSE[@]}" exec -T api node dist/cli.js health --mqtt-roundtrip || fail "health check after the update"
grep -q -- '--source' /opt/perspice/scripts/update.sh || fail "the updater was not refreshed"
perspice status >/dev/null 2>&1 || fail "perspice CLI"
fi

log "Updating to a broken build: it must roll back"
cp -r /opt/src/new /opt/src/broken
echo "${NEW}-broken" >/opt/src/broken/VERSION
# Migrations run, then the migration step fails: the snapshot must be restored.
sed -i "s|command: \['sh', '-c', 'node dist/cli.js migrate && node dist/cli.js seed'\]|command: ['sh', '-c', 'node dist/cli.js migrate \&\& exit 3']|" /opt/src/broken/deploy/docker-compose.yml
grep -q 'migrate && exit 3' /opt/src/broken/deploy/docker-compose.yml || fail "could not break the build"
api "${auth[@]}" -X PATCH "$BASE/api/devices/$device" -d '{"name":"survivor-2"}' >/dev/null || fail "rename before the broken update"
set +e
bash /opt/perspice/scripts/update.sh --yes --source /opt/src/broken --allow-downgrade 2>&1 | tee /work/broken.log
status="${PIPESTATUS[0]}"
set -e
[[ "$status" == "1" ]] || fail "the broken update exited $status, not 1"
grep -q "rolled back to $NEW" /work/broken.log || fail "no rollback message"
[[ "$(version)" == "$NEW" ]] || fail "version after the rollback is $(version)"
for svc in api ingest rules scheduler; do
  for _ in $(seq 1 60); do
    cid="$("${COMPOSE[@]}" ps -q "$svc")"
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null)" == "healthy" ]] && break
    sleep 2
  done
done
access="$(login)"
[[ "$(api -H "authorization: Bearer $access" "$BASE/api/devices/$device" | jq -r .name)" == "survivor-2" ]] || fail "data changed by the rollback"
[[ "$(latest_temp "$access")" == "$LAST_TEMP" ]] || fail "telemetry lost in the rollback"
"${COMPOSE[@]}" exec -T api node dist/cli.js health --mqtt-roundtrip || fail "health check after the rollback"

if [[ "$FRESH" == "1" ]]; then
  log "INSTALL E2E OK: $NEW installed fresh, and a failed update rolled back"
else
  log "INSTALL E2E OK: $FROM installed, updated to $NEW, and a failed update rolled back"
fi
