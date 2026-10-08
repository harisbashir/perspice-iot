#!/usr/bin/env bats

load helpers

setup() {
  setup_home
  install_docker_stub
  write_env 0.1.0
}

@test "refuses to downgrade without --allow-downgrade" {
  run bash "$SCRIPTS/update.sh" --dry-run --version 0.0.1
  [ "$status" -eq 3 ]
  [[ "$output" == *"Refusing to downgrade"* ]]
}

@test "a successful update snapshots, migrates and restarts in order" {
  run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 0 ]
  grep -q 'pg_dump' "$STUB_LOG"
  grep -q 'run --rm migrate' "$STUB_LOG"
  order="$(grep -o 'up -d --no-deps [a-z]*' "$STUB_LOG" | awk '{print $4}' | paste -sd' ')"
  [ "$order" = "ingest rules scheduler api caddy" ]
  grep -q '^PERSPICE_VERSION=0.2.0$' "$PERSPICE_HOME/.env"
  ls "$PERSPICE_HOME"/backups/pre-update-0.1.0-*.dump
}

@test "a failed health check rolls back the version and restores the snapshot" {
  STUB_FAIL_ON="health --mqtt-roundtrip" run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"rolled back to 0.1.0"* ]]
  grep -q 'pg_restore' "$STUB_LOG"
  grep -q 'timescaledb_post_restore' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.1.0$' "$PERSPICE_HOME/.env"
}

@test "a failed pull rolls back without restoring the database" {
  STUB_FAIL_ON="pull" run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 1 ]
  ! grep -q 'pg_restore' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.1.0$' "$PERSPICE_HOME/.env"
}
