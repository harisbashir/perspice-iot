#!/usr/bin/env bats

load helpers

setup() {
  setup_home
}

@test "dry run on a machine without Docker plans to install it and writes a private .env" {
  PATH="$(path_without_docker)" run bash "$SCRIPTS/install.sh" --dry-run --non-interactive \
    --domain example.com --admin-email admin@example.com --version 0.1.0
  [ "$status" -eq 0 ]
  [[ "$output" == *"Install Docker"* ]]
  [[ "$output" == *"[dry-run] apt-get install"* ]]
  [ "$(stat -c %a "$PERSPICE_HOME/.env")" = "600" ]
  for key in POSTGRES_PASSWORD JWT_SECRET MASTER_KEY INTERNAL_SECRET MQTT_INGEST_PASSWORD EMQX_API_SECRET EMQX_DASHBOARD_PASSWORD; do
    value="$(sed -n "s/^${key}=//p" "$PERSPICE_HOME/.env")"
    [ -n "$value" ] || { echo "missing $key"; false; }
  done
  grep -q '^BASE_DOMAIN=example.com$' "$PERSPICE_HOME/.env"
  grep -q '^PERSPICE_VERSION=0.1.0$' "$PERSPICE_HOME/.env"
}

@test "re-running without --reinstall refuses with exit code 2" {
  write_env 0.1.0
  run bash "$SCRIPTS/install.sh" --dry-run --non-interactive --domain example.com --admin-email admin@example.com --version 0.1.0
  [ "$status" -eq 2 ]
  [[ "$output" == *"existing installation"* ]]
}

@test "non-interactive mode requires the domain" {
  run bash "$SCRIPTS/install.sh" --dry-run --non-interactive --admin-email admin@example.com --version 0.1.0
  [ "$status" -eq 64 ]
  [[ "$output" == *"--domain"* ]]
}
