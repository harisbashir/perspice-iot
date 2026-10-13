#!/usr/bin/env bash
# Upgrades an installation to a new release: a full backup (v0.4.0 and later) and a database
# snapshot first, and automatic rollback if the new version does not come up healthy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: update.sh [--version vX.Y.Z | --source <dir|tar.gz>] [--yes] [--allow-downgrade] [--dry-run]

  --version          Target release (default: latest)
  --source           Build the target from a source tree or release tarball instead of pulling
                     images (installs made with --build, offline servers); its VERSION is the target
  --yes              Do not ask for confirmation
  --allow-downgrade  Permit installing an older version than the current one
  --dry-run          Show what would happen without changing anything
USAGE
}

TARGET="" SOURCE="" YES=0 ALLOW_DOWNGRADE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) TARGET="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" 64 ;;
  esac
done

# A source tree (or a release tarball, unpacked) to build from: its VERSION is the target.
if [[ -n "$SOURCE" ]]; then
  if [[ -f "$SOURCE" ]]; then
    unpacked="$(mktemp -d)"
    tar -xzf "$SOURCE" -C "$unpacked" --strip-components=1 || die "Could not unpack $SOURCE" 64
    SOURCE="$unpacked"
  fi
  [[ -f "$SOURCE/VERSION" ]] || die "No VERSION file in $SOURCE: not a Perspice source tree." 64
  [[ -n "$TARGET" ]] || TARGET="$(tr -d '[:space:]' <"$SOURCE/VERSION")"
  export PERSPICE_SRC="$SOURCE"
fi

[[ -f "$PERSPICE_HOME/.env" ]] || die "No installation found in $PERSPICE_HOME." 2
LOG="$PERSPICE_HOME/update.log"
CURRENT="$(env_get PERSPICE_VERSION)"
if [[ -z "$TARGET" ]]; then
  TARGET="$(latest_release 2>/dev/null || true)"
  [[ -n "$TARGET" ]] || die "Could not determine the latest release (offline?). Pass --version." 64
fi
TARGET="${TARGET#v}"

if [[ "$TARGET" == "$CURRENT" ]]; then
  info "Already on $CURRENT."
  exit 0
fi
if version_gt "$CURRENT" "$TARGET" && [[ "$ALLOW_DOWNGRADE" != "1" ]]; then
  die "Refusing to downgrade from $CURRENT to $TARGET (use --allow-downgrade)." 3
fi

info "Updating Perspice $CURRENT → $TARGET"
if [[ "$YES" != "1" && "$DRY_RUN" != "1" ]]; then
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || exit 1
fi
[[ "$DRY_RUN" == "1" ]] || exec > >(tee -a "$LOG") 2>&1
info "$(date -u +%FT%TZ) update $CURRENT → $TARGET"

SNAPSHOT=""
MIGRATED=0

# A real MQTT round trip, with a few tries while services settle after a restart.
mqtt_healthy() {
  local _
  for _ in $(seq 1 "${PERSPICE_HEALTH_ATTEMPTS:-6}"); do
    if run_or_print compose exec -T api node dist/cli.js health --mqtt-roundtrip; then return 0; fi
    sleep "${PERSPICE_HEALTH_DELAY_S:-10}"
  done
  return 1
}

rollback() {
  warn "Update failed; rolling back to $CURRENT."
  env_set PERSPICE_VERSION "$CURRENT"
  if [[ -f "$PERSPICE_HOME/docker-compose.yml.previous" ]]; then
    mv "$PERSPICE_HOME/docker-compose.yml.previous" "$PERSPICE_HOME/docker-compose.yml"
  fi
  if [[ "$MIGRATED" == "1" && -n "$SNAPSHOT" ]]; then
    info "Restoring the pre-update database snapshot $SNAPSHOT"
    db_restore_from "$SNAPSHOT" || warn "Restoring the snapshot failed; restore it manually with: perspice db-restore $SNAPSHOT"
  fi
  # The target may have added services (a renderer, say) that the rolled-back release doesn't have.
  compose up -d --remove-orphans || true
  # The restarted API takes the broker a moment to reach again; report once devices can connect.
  mqtt_healthy || warn "MQTT isn't answering yet after the rollback; check: perspice logs emqx"
  die "Update to $TARGET failed and was rolled back to $CURRENT. Details: $LOG" 1
}

step "1/5 Backup and database snapshot"
# Backups (v0.4.0) need a passphrase; older installs get one now. Services pick it up on restart.
if [[ -z "$(env_get BACKUP_PASSPHRASE)" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    run_or_print env_set BACKUP_PASSPHRASE "<generated>"
  else
    env_set BACKUP_PASSPHRASE "$(gen_secret 32)"
    warn "Generated BACKUP_PASSPHRASE in $PERSPICE_HOME/.env. Keep a copy elsewhere: backups can't be read without it."
  fi
fi
# A full backup (database and files, encrypted) when the running version can make one.
if ! version_gt 0.4.0 "$CURRENT"; then
  BACKUP="$PERSPICE_HOME/backups/pre-update-${CURRENT}-$(date -u +%Y%m%dT%H%M%SZ).pbk"
  if [[ "$DRY_RUN" == "1" ]]; then
    run_or_print backup "→ $BACKUP"
  else
    if ! compose exec -T api node dist/cli.js backup --out - >"$BACKUP" || [[ ! -s "$BACKUP" ]]; then
      rm -f "$BACKUP"
      die "Backup failed; nothing was changed."
    fi
    chmod 600 "$BACKUP"
    find "$PERSPICE_HOME/backups" -name 'pre-update-*.pbk' ! -path "$BACKUP" -delete
    ok "$BACKUP"
  fi
fi
# The snapshot is what an automatic rollback restores (it doesn't need the new version running).
SNAPSHOT="$PERSPICE_HOME/backups/pre-update-${CURRENT}-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [[ "$DRY_RUN" == "1" ]]; then
  run_or_print pg_dump "→ $SNAPSHOT"
else
  db_snapshot_to "$SNAPSHOT" || die "Database snapshot failed; nothing was changed."
  # Keep only the newest pre-update snapshot.
  find "$PERSPICE_HOME/backups" -name 'pre-update-*.dump' ! -path "$SNAPSHOT" -delete
  ok "$SNAPSHOT"
fi

step "2/5 $([[ -n "$SOURCE" ]] && echo Building || echo Pulling) $TARGET"
# New releases can add services (v0.2.0: renderer), so the compose file comes from the target.
[[ "$DRY_RUN" == "1" ]] || cp "$PERSPICE_HOME/docker-compose.yml" "$PERSPICE_HOME/docker-compose.yml.previous"
run_or_print fetch_deploy_files "$TARGET" || rollback
[[ "$DRY_RUN" == "1" ]] || env_set PERSPICE_VERSION "$TARGET"
if [[ -n "$SOURCE" ]]; then
  owner="$(env_get PERSPICE_IMAGE_OWNER)"
  for image in server web renderer; do
    run_or_print docker build -t "ghcr.io/${owner:-perspice}/perspice-${image}:$TARGET" -f "$SOURCE/deploy/Dockerfile.${image}" "$SOURCE" || rollback
  done
else
  # cert-sync is built here, never published: pulling it would fail.
  run_or_print compose pull --quiet --ignore-buildable || rollback
fi
run_or_print compose build cert-sync || rollback

step "3/5 Migrating the database"
MIGRATED=1
run_or_print compose run --rm migrate || rollback

step "4/5 Restarting services"
# Infrastructure first: its configuration changes between releases too (0.4.0 added the broker's
# internal listener, 1.0 the database healthcheck), and the app services need the new one.
# Compose only recreates a container whose configuration changed.
if [[ "$DRY_RUN" == "1" ]]; then
  services=(redis postgres emqx cert-sync ingest rules scheduler renderer api caddy)
else
  mapfile -t services < <(compose_services redis postgres emqx cert-sync ingest rules scheduler renderer api caddy)
fi
for svc in "${services[@]}"; do
  # The broker and cert-sync render configuration files from the release when they start, and
  # Compose can't see those files change: recreate them every time.
  recreate=()
  [[ "$svc" == emqx || "$svc" == cert-sync ]] && recreate=(--force-recreate)
  run_or_print compose up -d "${recreate[@]}" --no-deps "$svc" || rollback
  [[ "$svc" == caddy || "$svc" == cert-sync ]] && continue
  wait_healthy "$svc" 180 || rollback
  ok "$svc"
done
# Services the new release adds that aren't in the list above.
run_or_print compose up -d --remove-orphans || rollback

step "5/5 Health check"
# Freshly restarted, ingest may still be settling: a few tries before deciding it's broken.
mqtt_healthy || rollback

rm -f "$PERSPICE_HOME/docker-compose.yml.previous"
ok "Perspice $TARGET is running."
