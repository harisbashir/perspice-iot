#!/usr/bin/env bash
# Runs the test suites. Default: --unit --integration --e2e. Stops at the first failing suite.
#   --unit | --integration | --e2e | --load | --live <url> | --all
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
    -h | --help) sed -n '2,3p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
done
[[ ${#suites[@]} -gt 0 ]] || suites=(unit integration e2e)

pnpm() { corepack pnpm "$@"; }

run_suite() {
  case "$1" in
    unit) pnpm test:unit ;;
    integration) pnpm test:integration ;;
    e2e) pnpm --filter @perspice/e2e test ;;
    load) pnpm --filter @perspice/simulator load ;;
    live) PERSPICE_LIVE_URL="$LIVE_URL" pnpm --filter @perspice/e2e test:live ;;
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
