#!/usr/bin/env bash
# Runs the test suites. Default: --unit --integration --e2e. Stops at the first failing suite.
#   --unit | --integration | --e2e | --load | --live <url> | --all
# --load runs deploy/test/loadtest.sh: the 4 vCPU / 8 GB stack with 10,000 devices for 15 minutes
# (docs/load-test.md). To load an existing stack instead, set PERSPICE_LOAD_URL, PERSPICE_LOAD_MQTT
# and PERSPICE_LOAD_API_KEY (optionally PERSPICE_LOAD_COUNT, _DURATION, _PROFILE, and
# PERSPICE_LOAD_INSECURE=1 for a local stack with a self-signed certificate).
# --live needs PERSPICE_LIVE_ADMIN_TOKEN (an API key) and optionally PERSPICE_LIVE_MQTT_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

suites=()
LIVE_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit | --integration | --e2e | --load) suites+=("${1#--}"); shift ;;
    --live) LIVE_URL="${2:?--live needs a URL}"; suites+=(live); shift 2 ;;
    --all) suites+=(unit integration e2e load); shift ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
done
[[ ${#suites[@]} -gt 0 ]] || suites=(unit integration e2e)

pnpm() { corepack pnpm "$@"; }

run_suite() {
  case "$1" in
    unit) pnpm test:unit ;;
    integration) pnpm test:integration ;;
    e2e) bash e2e/run.sh assets ;; # runs every project before it (dependencies)
    load)
      if [[ -z "${PERSPICE_LOAD_URL:-}" ]]; then
        bash deploy/test/loadtest.sh
        return
      fi
      : "${PERSPICE_LOAD_MQTT:?set PERSPICE_LOAD_MQTT}" "${PERSPICE_LOAD_API_KEY:?set PERSPICE_LOAD_API_KEY}"
      pnpm --filter @perspice/shared build && pnpm --filter @perspice/simulator build
      node apps/simulator/dist/index.js --url "$PERSPICE_LOAD_URL" --mqtt "$PERSPICE_LOAD_MQTT" --api-key "$PERSPICE_LOAD_API_KEY" \
        --profile "${PERSPICE_LOAD_PROFILE:-Generic Sensor}" --create --count "${PERSPICE_LOAD_COUNT:-1000}" --interval 10 \
        --duration "${PERSPICE_LOAD_DURATION:-120}" --measure-latency --max-p95-ms 2000 --connect-rate 500 \
        ${PERSPICE_LOAD_INSECURE:+--insecure}
      ;;
    live) PERSPICE_LIVE_URL="$LIVE_URL" bash e2e/run.sh live ;;
  esac
}

declare -A results
status=0
for suite in "${suites[@]}"; do
  printf '\n==> %s\n' "$suite"
  start=$SECONDS
  if run_suite "$suite"; then
    results[$suite]="passed ($((SECONDS - start))s)"
  else
    results[$suite]="FAILED ($((SECONDS - start))s)"
    status=1
    break
  fi
done

printf '\n%-12s %s\n' "Suite" "Result"
for suite in "${suites[@]}"; do printf '%-12s %s\n' "$suite" "${results[$suite]:-skipped}"; done
exit "$status"
