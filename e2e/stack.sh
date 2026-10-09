#!/usr/bin/env bash
# Starts (up) or removes (down) the Compose stack used by the end-to-end tests, with Mailpit as
# the SMTP server and a super admin whose activation email is waiting in Mailpit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="perspice-e2e"
STATE="$ROOT/e2e/.stack"
ENV_FILE="$STATE/.env"
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml" -f "$ROOT/e2e/compose.override.yml" --profile mail-test)
BASE="https://localhost:18443"

secret() { openssl rand -base64 "$1" | tr -d '\n=/+'; }

up() {
  mkdir -p "$STATE"
  docker build -q -f "$ROOT/deploy/Dockerfile.server" -t ghcr.io/local/perspice-server:e2e "$ROOT" >/dev/null
  docker build -q -f "$ROOT/deploy/Dockerfile.web" -t ghcr.io/local/perspice-web:e2e "$ROOT" >/dev/null
  cat >"$ENV_FILE" <<ENV
PERSPICE_VERSION=e2e
PERSPICE_IMAGE_OWNER=local
BASE_DOMAIN=localhost
PUBLIC_URL=$BASE
ACME_EMAIL=e2e@perspice.test
POSTGRES_PASSWORD=$(secret 24)
JWT_SECRET=$(secret 48)
MASTER_KEY=$(openssl rand -base64 32)
INTERNAL_SECRET=$(secret 24)
MQTT_INGEST_PASSWORD=$(secret 24)
EMQX_API_KEY=perspice
EMQX_API_SECRET=$(secret 24)
EMQX_DASHBOARD_PASSWORD=$(secret 24)
MQTT_PLAIN_ENABLED=true
ENV
  "${COMPOSE[@]}" up -d --quiet-pull >/dev/null 2>&1
  for _ in $(seq 1 90); do
    curl -fsSk "$BASE/health" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -fsSk "$BASE/health" >/dev/null
  "${COMPOSE[@]}" exec -T api node dist/cli.js configure-smtp --host mailpit --port 1025 --from "Perspice <no-reply@perspice.test>" >/dev/null
  "${COMPOSE[@]}" exec -T api node dist/cli.js create-admin --email owner@perspice.test --name "Platform Owner" >/dev/null
  echo "e2e stack is up at $BASE"
}

down() {
  if [[ -f "$ENV_FILE" ]]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$STATE"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  logs) "${COMPOSE[@]}" logs --tail 100 ;;
  *) echo "usage: stack.sh up|down|logs" >&2; exit 64 ;;
esac
