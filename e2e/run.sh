#!/usr/bin/env bash
# Runs the Playwright suite in Microsoft's Playwright image (bundled browsers and system
# libraries) against a freshly started stack.  Usage: e2e/run.sh [operations|alarms|dashboards|core|live] [playwright args…]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${1:-alarms}"
shift || true
PW_VERSION="$(node -p "require('$ROOT/e2e/node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

run_playwright() {
  docker run --rm --network host --ipc host \
    -e E2E_BASE_URL -e E2E_MQTT_URL -e E2E_MAILPIT_URL -e PERSPICE_LIVE_URL -e PERSPICE_LIVE_ADMIN_TOKEN -e PERSPICE_LIVE_MQTT_URL -e NODE_TLS_REJECT_UNAUTHORIZED -e CI \
    -v "$ROOT:/work" -w /work/e2e --user "$(id -u):$(id -g)" -e HOME=/tmp \
    "$IMAGE" npx playwright test --project="$PROJECT" "$@"
}

if [[ "$PROJECT" == "live" ]]; then
  run_playwright "$@"
  exit
fi

trap '[[ "${KEEP_STACK:-}" == 1 ]] || "$ROOT/e2e/stack.sh" down' EXIT
"$ROOT/e2e/stack.sh" up
export E2E_BASE_URL="https://localhost:18443" E2E_MQTT_URL="mqtt://localhost:11883" E2E_MAILPIT_URL="http://localhost:18025"
run_playwright "$@"
