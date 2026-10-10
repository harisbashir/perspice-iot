#!/usr/bin/env bash
# Shared helpers for install.sh, update.sh, test.sh and the perspice wrapper.
# shellcheck disable=SC2034  # variables here are used by the scripts that source this file

PERSPICE_HOME="${PERSPICE_HOME:-/opt/perspice}"
PERSPICE_REPO="${PERSPICE_REPO:-perspice/perspice-iot}"
DRY_RUN="${DRY_RUN:-0}"

if [[ -t 1 ]]; then
  _bold=$'\e[1m' _red=$'\e[31m' _yellow=$'\e[33m' _green=$'\e[32m' _reset=$'\e[0m'
else
  _bold='' _red='' _yellow='' _green='' _reset=''
fi

info() { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$_bold" "$*" "$_reset"; }
ok() { printf '%s✓%s %s\n' "$_green" "$_reset" "$*"; }
warn() { printf '%sWarning:%s %s\n' "$_yellow" "$_reset" "$*" >&2; }
die() {
  printf '%sError:%s %s\n' "$_red" "$_reset" "$1" >&2
  exit "${2:-1}"
}

# Runs a command, or only prints it in dry-run mode.
run_or_print() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

require_root() {
  [[ "$DRY_RUN" == "1" || "${PERSPICE_SKIP_ROOT_CHECK:-0}" == "1" ]] && return 0
  [[ "$(id -u)" -eq 0 ]] || die "Please run as root (for example with sudo)."
}

# Prints "<id> <version>" for a supported OS, or fails. Supported: Ubuntu ≥ 22.04, Debian ≥ 12.
detect_os() {
  local file="${1:-/etc/os-release}" id version major
  [[ -r "$file" ]] || return 1
  # shellcheck disable=SC1090  # os-release is a plain KEY=value file
  id="$(. "$file" && printf '%s' "${ID:-}")"
  # shellcheck disable=SC1090
  version="$(. "$file" && printf '%s' "${VERSION_ID:-}")"
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  case "$id" in
    ubuntu) ((major >= 22)) || return 1 ;;
    debian) ((major >= 12)) || return 1 ;;
    *) return 1 ;;
  esac
  printf '%s %s\n' "$id" "$version"
}

# Prints amd64 or arm64, or fails on other architectures.
detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo amd64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) return 1 ;;
  esac
}

# True when semantic version $1 is greater than $2 (leading "v" ignored).
version_gt() {
  local a="${1#v}" b="${2#v}"
  [[ "$a" != "$b" ]] && [[ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -n1)" == "$a" ]]
}

# Random URL-safe secret of roughly $1 bytes of entropy.
gen_secret() {
  openssl rand -base64 "${1:-32}" | tr -d '\n=+/'
}

compose() {
  local files=(-f "$PERSPICE_HOME/docker-compose.yml")
  # AWS IoT Core installs replace EMQX through an override file.
  if [[ "$(env_get MQTT_TRANSPORT 2>/dev/null || true)" == "aws-iot" ]]; then files+=(-f "$PERSPICE_HOME/docker-compose.aws.yml"); fi
  docker compose -p perspice "${files[@]}" --env-file "$PERSPICE_HOME/.env" "$@"
}

# Reads KEY from the install's .env file.
env_get() {
  local key="$1" file="${2:-$PERSPICE_HOME/.env}"
  sed -n "s/^${key}=//p" "$file" | tail -n1
}

# Sets KEY=value in the .env file (adds it when missing), keeping mode 600.
env_set() {
  local key="$1" value="$2" file="${3:-$PERSPICE_HOME/.env}"
  if grep -q "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" >"$tmp"
    cat "$tmp" >"$file"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
  chmod 600 "$file"
}

# Waits until a compose service's container reports healthy (default 120 s).
wait_healthy() {
  local service="$1" timeout="${2:-120}" waited=0 cid status
  [[ "$DRY_RUN" == "1" ]] && { printf '[dry-run] wait for %s to be healthy\n' "$service"; return 0; }
  while ((waited < timeout)); do
    cid="$(compose ps -q "$service" 2>/dev/null | head -n1)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      [[ "$status" == "healthy" ]] && return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# Latest release tag from GitHub (e.g. v0.1.0).
latest_release() {
  curl -fsSL "https://api.github.com/repos/${PERSPICE_REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1
}

APP_SERVICES=(api ingest rules scheduler renderer)

# Installs the deployment files of release $1 (compose file, EMQX and cert-sync config, this
# library) into $PERSPICE_HOME: from the checkout in $PERSPICE_SRC when set, otherwise from the
# release's source archive.
fetch_deploy_files() {
  local version="$1" src="${PERSPICE_SRC:-}" tmp=""
  if [[ -z "$src" ]]; then
    tmp="$(mktemp -d)"
    src="$tmp"
    if ! curl -fsSL "https://github.com/${PERSPICE_REPO}/archive/refs/tags/v${version}.tar.gz" | tar -xz -C "$src" --strip-components=1; then
      rm -rf "$tmp"
      return 1
    fi
  fi
  cp "$src/deploy/docker-compose.yml" "$src/deploy/docker-compose.aws.yml" "$PERSPICE_HOME/"
  cp -r "$src/deploy/emqx" "$src/deploy/cert-sync" "$src/deploy/monitoring" "$PERSPICE_HOME/"
  install -d "$PERSPICE_HOME/scripts/lib"
  install -m 0644 "$src/scripts/lib/common.sh" "$PERSPICE_HOME/scripts/lib/common.sh"
  # The updater and CLI of the target, so the next update runs the new code. `install` writes a
  # new file, so a running update.sh keeps reading its own copy.
  if [[ -f "$src/scripts/update.sh" ]]; then install -m 0755 "$src/scripts/update.sh" "$PERSPICE_HOME/scripts/update.sh"; fi
  if [[ -f "$src/scripts/perspice" && -w /usr/local/bin ]]; then install -m 0755 "$src/scripts/perspice" /usr/local/bin/perspice; fi
  if [[ -n "$tmp" ]]; then rm -rf "$tmp"; fi
}

# Writes a custom-format dump of the database to $1.
db_snapshot_to() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  compose exec -T postgres pg_dump -U perspice -d perspice -Fc >"$file"
  chmod 600 "$file"
}

# Restores a dump the way TimescaleDB supports: into a fresh database (pre/post-restore hooks),
# which replaces the live one only after the restore succeeded.
db_restore_from() {
  local file="$1"
  [[ -s "$file" ]] || die "Dump not found or empty: $file"
  local psql=(compose exec -T postgres psql -U perspice -v ON_ERROR_STOP=1 -q)
  compose stop "${APP_SERVICES[@]}"
  "${psql[@]}" -d postgres -c 'DROP DATABASE IF EXISTS perspice_restore WITH (FORCE)' -c 'CREATE DATABASE perspice_restore'
  "${psql[@]}" -d perspice_restore -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' -c 'SELECT timescaledb_pre_restore()'
  compose exec -T postgres pg_restore -U perspice -d perspice_restore --no-owner --exit-on-error <"$file"
  "${psql[@]}" -d perspice_restore -c 'SELECT timescaledb_post_restore()'
  "${psql[@]}" -d postgres -c 'DROP DATABASE perspice WITH (FORCE)' -c 'ALTER DATABASE perspice_restore RENAME TO perspice'
  compose start "${APP_SERVICES[@]}"
}
