#!/usr/bin/env bats

load helpers

setup() {
  setup_home
  install_docker_stub
  write_env 0.1.0
  export PERSPICE_SRC="$SCRIPTS/.."
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
  order="$(grep -o 'up -d --no-deps [a-z-]*' "$STUB_LOG" | awk '{print $4}' | paste -sd' ')"
  # Infrastructure first (its configuration can change between releases), then the app.
  [ "$order" = "redis postgres emqx cert-sync ingest rules scheduler renderer api caddy" ]
  grep -q '^  renderer:' "$PERSPICE_HOME/docker-compose.yml"
  [ ! -e "$PERSPICE_HOME/docker-compose.yml.previous" ]
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
  # The previous compose file is back.
  [ ! -s "$PERSPICE_HOME/docker-compose.yml" ]
}

@test "a failed pull rolls back without restoring the database" {
  STUB_FAIL_ON="pull" run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 1 ]
  ! grep -q 'pg_restore' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.1.0$' "$PERSPICE_HOME/.env"
}

@test "an install without a backup passphrase gets one; versions before 0.4.0 can't make a full backup" {
  run bash "$SCRIPTS/update.sh" --yes --version 0.4.0
  [ "$status" -eq 0 ]
  [ -n "$(sed -n 's/^BACKUP_PASSPHRASE=//p' "$PERSPICE_HOME/.env")" ]
  [[ "$output" == *"Keep a copy elsewhere"* ]]
  ! grep -q 'backup --out' "$STUB_LOG"
}

@test "from 0.4.0 on, a full backup is taken before anything changes, and only the newest is kept" {
  write_env 0.4.0
  echo 'BACKUP_PASSPHRASE=already-set-passphrase' >>"$PERSPICE_HOME/.env"
  mkdir -p "$PERSPICE_HOME/backups" && touch "$PERSPICE_HOME/backups/pre-update-0.3.0-20260101T000000Z.pbk"
  run bash "$SCRIPTS/update.sh" --yes --version 0.5.0
  [ "$status" -eq 0 ]
  grep -q '^BACKUP_PASSPHRASE=already-set-passphrase$' "$PERSPICE_HOME/.env"
  backups=("$PERSPICE_HOME"/backups/pre-update-*.pbk)
  [ "${#backups[@]}" -eq 1 ]
  [[ "${backups[0]}" == *pre-update-0.4.0-* ]]
  [ "$(cat "${backups[0]}")" = "PSPBK1 fake backup" ]
  [ "$(stat -c %a "${backups[0]}")" = "600" ]
  # The backup comes before the pull.
  [ "$(grep -n 'backup --out' "$STUB_LOG" | cut -d: -f1)" -lt "$(grep -n 'pull' "$STUB_LOG" | head -n1 | cut -d: -f1)" ]
}

@test "a failed backup stops the update with nothing changed" {
  write_env 0.4.0
  STUB_FAIL_ON="backup --out" run bash "$SCRIPTS/update.sh" --yes --version 0.5.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"Backup failed; nothing was changed"* ]]
  ! grep -q 'pull' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.4.0$' "$PERSPICE_HOME/.env"
  [ -z "$(ls "$PERSPICE_HOME"/backups/*.pbk 2>/dev/null)" ]
}

# A minimal source tree of release $1 (what --source reads).
make_source() {
  local dir="$BATS_TEST_TMPDIR/src-$1"
  mkdir -p "$dir/deploy" "$dir/scripts/lib"
  echo "$1" >"$dir/VERSION"
  cp -r "$SCRIPTS/../deploy/." "$dir/deploy/"
  cp "$SCRIPTS/lib/common.sh" "$dir/scripts/lib/common.sh"
  cp "$SCRIPTS/update.sh" "$dir/scripts/update.sh"
  echo '# new updater' >>"$dir/scripts/update.sh"
  echo "$dir"
}

@test "--source builds the target's images from the tree instead of pulling" {
  unset PERSPICE_SRC
  src="$(make_source 0.9.0)"
  run bash "$SCRIPTS/update.sh" --yes --source "$src"
  [ "$status" -eq 0 ]
  grep -q "build -t ghcr.io/perspice/perspice-server:0.9.0 -f $src/deploy/Dockerfile.server $src" "$STUB_LOG"
  grep -q "build -t ghcr.io/perspice/perspice-web:0.9.0" "$STUB_LOG"
  grep -q "build -t ghcr.io/perspice/perspice-renderer:0.9.0" "$STUB_LOG"
  ! grep -q 'pull' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.9.0$' "$PERSPICE_HOME/.env"
  # The deployment files and the updater itself come from the target.
  grep -q '^  renderer:' "$PERSPICE_HOME/docker-compose.yml"
  grep -q '# new updater' "$PERSPICE_HOME/scripts/update.sh"
}

@test "--source also takes a release tarball" {
  unset PERSPICE_SRC
  src="$(make_source 0.9.1)"
  tar -czf "$BATS_TEST_TMPDIR/perspice-0.9.1.tar.gz" -C "$(dirname "$src")" "$(basename "$src")"
  run bash "$SCRIPTS/update.sh" --yes --source "$BATS_TEST_TMPDIR/perspice-0.9.1.tar.gz"
  [ "$status" -eq 0 ]
  grep -q 'build -t ghcr.io/perspice/perspice-server:0.9.1' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.9.1$' "$PERSPICE_HOME/.env"
}

@test "a failed build rolls back without touching the database" {
  unset PERSPICE_SRC
  src="$(make_source 0.9.0)"
  STUB_FAIL_ON="Dockerfile.web" run bash "$SCRIPTS/update.sh" --yes --source "$src"
  [ "$status" -eq 1 ]
  ! grep -q 'run --rm migrate' "$STUB_LOG"
  ! grep -q 'pg_restore' "$STUB_LOG"
  grep -q '^PERSPICE_VERSION=0.1.0$' "$PERSPICE_HOME/.env"
}

@test "--source without a VERSION file is refused" {
  mkdir -p "$BATS_TEST_TMPDIR/empty"
  run bash "$SCRIPTS/update.sh" --yes --source "$BATS_TEST_TMPDIR/empty"
  [ "$status" -eq 64 ]
  [[ "$output" == *"VERSION"* ]]
}

@test "a rollback to a release without some services restores and restarts only those it has" {
  # The release rolled back to (e.g. 0.1.0) has no renderer.
  STUB_SERVICES="postgres redis emqx cert-sync api ingest rules scheduler web caddy" STUB_FAIL_ON="health --mqtt-roundtrip" \
    run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"rolled back to 0.1.0"* ]]
  [[ "$output" != *"Restoring the snapshot failed"* ]]
  grep -q 'stop api ingest rules scheduler$' "$STUB_LOG"
  grep -q 'start api ingest rules scheduler$' "$STUB_LOG"
  grep -q 'up -d --remove-orphans' "$STUB_LOG"
}

@test "a failing restore is reported, not hidden" {
  STUB_FAIL_ON="health --mqtt-roundtrip|pg_restore" run bash "$SCRIPTS/update.sh" --yes --version 0.2.0
  [ "$status" -eq 1 ]
  [[ "$output" == *"Restoring the snapshot failed"* ]]
}
