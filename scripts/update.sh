#!/usr/bin/env bash
# Upgrades an installation to a new release with a pre-update database snapshot and automatic
# rollback if the new version does not come up healthy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: update.sh [--version vX.Y.Z] [--yes] [--allow-downgrade] [--dry-run]

  --version          Target release (default: latest)
  --yes              Do not ask for confirmation
  --allow-downgrade  Permit installing an older version than the current one
  --dry-run          Show what would happen without changing anything
USAGE
}

TARGET="" YES=0 ALLOW_DOWNGRADE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) TARGET="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" 64 ;;
  esac
done

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

rollback() {
  warn "Update failed; rolling back to $CURRENT."
  env_set PERSPICE_VERSION "$CURRENT"
  if [[ "$MIGRATED" == "1" && -n "$SNAPSHOT" ]]; then
    info "Restoring the pre-update database snapshot $SNAPSHOT"
    db_restore_from "$SNAPSHOT" || warn "Restoring the snapshot failed; restore it manually with: perspice db-restore $SNAPSHOT"
  fi
  compose up -d || true
  die "Update to $TARGET failed and was rolled back to $CURRENT. Details: $LOG" 1
}

step "1/5 Database snapshot"
SNAPSHOT="$PERSPICE_HOME/backups/pre-update-${CURRENT}-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [[ "$DRY_RUN" == "1" ]]; then
  run_or_print pg_dump "→ $SNAPSHOT"
else
  db_snapshot_to "$SNAPSHOT" || die "Database snapshot failed; nothing was changed."
  # Keep only the newest pre-update snapshot.
  find "$PERSPICE_HOME/backups" -name 'pre-update-*.dump' ! -path "$SNAPSHOT" -delete
  ok "$SNAPSHOT"
fi

step "2/5 Pulling $TARGET"
[[ "$DRY_RUN" == "1" ]] || env_set PERSPICE_VERSION "$TARGET"
run_or_print compose pull --quiet || rollback

step "3/5 Migrating the database"
MIGRATED=1
run_or_print compose run --rm migrate || rollback

step "4/5 Restarting services"
for svc in ingest rules scheduler api caddy; do
  run_or_print compose up -d --no-deps "$svc" || rollback
  [[ "$svc" == caddy ]] && continue
  wait_healthy "$svc" 120 || rollback
  ok "$svc"
done

step "5/5 Health check"
run_or_print compose exec -T api node dist/cli.js health --mqtt-roundtrip || rollback

ok "Perspice $TARGET is running."
