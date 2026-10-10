#!/usr/bin/env bash
# Installs Perspice IoT on Ubuntu 22.04+ / Debian 12+ (amd64, arm64) under /opt/perspice.
# Run `install.sh --help` for options. Safe to re-run: refuses an existing install unless --reinstall.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

  --domain <domain>          Base domain (platform UI; customers on <slug>.<domain>)
  --admin-email <email>      Super admin email (also used for certificate notices)
  --admin-name <name>        Super admin name (default: Administrator)
  --version <vX.Y.Z>         Release to install (default: latest; required when offline)
  --smtp-host <host> --smtp-port <port> --smtp-user <user> --smtp-pass <pass> --smtp-from <addr>
                             Outgoing email (optional; can be set later in Settings → Email)
  --mqtt-plain=true|false    Allow plain MQTT on 1883 (default: true)
  --mqtt=emqx|aws-iot        Device connectivity: the bundled EMQX broker (default) or AWS IoT Core
  --aws-region <region>      AWS region for IoT Core (default: S3 region, else us-east-1)
  --storage=local|s3         File storage: this server's disk (default) or an S3 bucket
  --s3-bucket <name> --s3-region <region> [--s3-endpoint <url>]
                             The bucket (credentials from the instance role, or AWS_ACCESS_KEY_ID
                             and AWS_SECRET_ACCESS_KEY in the environment)
  --build                    Build images from this checkout instead of pulling them
  --non-interactive          Never prompt; fail when a required value is missing
  --reinstall                Replace an existing installation (keeps data volumes)
  --dry-run                  Print what would be done; writes .env into PERSPICE_HOME only
  -h, --help                 Show this help
USAGE
}

DOMAIN="" ADMIN_EMAIL="" ADMIN_NAME="Administrator" VERSION="" BUILD=0 INTERACTIVE=1 REINSTALL=0
SMTP_HOST="" SMTP_PORT="587" SMTP_USER="" SMTP_PASS="" SMTP_FROM="" MQTT_PLAIN="true"
MQTT_MODE="emqx" AWS_REGION_ARG="" STORAGE="local" S3_BUCKET="" S3_REGION="" S3_ENDPOINT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-name) ADMIN_NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --smtp-host) SMTP_HOST="$2"; shift 2 ;;
    --smtp-port) SMTP_PORT="$2"; shift 2 ;;
    --smtp-user) SMTP_USER="$2"; shift 2 ;;
    --smtp-pass) SMTP_PASS="$2"; shift 2 ;;
    --smtp-from) SMTP_FROM="$2"; shift 2 ;;
    --mqtt-plain=*) MQTT_PLAIN="${1#*=}"; shift ;;
    --mqtt=*) MQTT_MODE="${1#*=}"; shift ;;
    --aws-region) AWS_REGION_ARG="$2"; shift 2 ;;
    --storage=*) STORAGE="${1#*=}"; shift ;;
    --s3-bucket) S3_BUCKET="$2"; shift 2 ;;
    --s3-region) S3_REGION="$2"; shift 2 ;;
    --s3-endpoint) S3_ENDPOINT="$2"; shift 2 ;;
    --build) BUILD=1; shift ;;
    --non-interactive) INTERACTIVE=0; shift ;;
    --reinstall) REINSTALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" 64 ;;
  esac
done

prompt() {
  local var="$1" question="$2" value
  [[ -n "${!var}" ]] && return 0
  [[ "$INTERACTIVE" == "1" ]] || die "Missing --${3} (required with --non-interactive)" 64
  read -r -p "$question: " value
  printf -v "$var" '%s' "$value"
}

[[ "$MQTT_MODE" == "emqx" || "$MQTT_MODE" == "aws-iot" ]] || die "Invalid --mqtt=$MQTT_MODE (emqx or aws-iot)" 64
[[ "$STORAGE" == "local" || "$STORAGE" == "s3" ]] || die "Invalid --storage=$STORAGE (local or s3)" 64
[[ "$STORAGE" != "s3" || -n "$S3_BUCKET" ]] || die "--storage=s3 needs --s3-bucket" 64
AWS_REGION_VALUE="${AWS_REGION_ARG:-${S3_REGION:-us-east-1}}"
AWS_IOT=0
[[ "$MQTT_MODE" == "aws-iot" ]] && AWS_IOT=1

if [[ -f "$PERSPICE_HOME/.env" && "$REINSTALL" != "1" ]]; then
  die "An existing installation was found in $PERSPICE_HOME. Use update.sh to upgrade, or --reinstall to replace it." 2
fi

# 1. System checks ------------------------------------------------------------------------------
step "1/8 Checking the system"
require_root
os="$(detect_os /etc/os-release)" || die "Unsupported OS. Perspice needs Ubuntu 22.04+ or Debian 12+."
arch="$(detect_arch)" || die "Unsupported CPU architecture $(uname -m) (need amd64 or arm64)."
ok "$os ($arch)"
cpus="$(nproc)"
mem_mb="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
disk_gb="$(df -Pk "$(dirname "$PERSPICE_HOME")" | awk 'NR == 2 { print int($4 / 1024 / 1024) }')"
((mem_mb >= 1900)) || die "At least 2 GB of RAM is required (found ${mem_mb} MB)."
((cpus >= 2)) || warn "2 vCPUs recommended (found $cpus)."
((mem_mb >= 3800)) || warn "4 GB of RAM recommended (found ${mem_mb} MB)."
((disk_gb >= 20)) || warn "20 GB of free disk recommended (found ${disk_gb} GB)."

# 2. Prerequisites --------------------------------------------------------------------------------
step "2/8 Installing prerequisites"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  info "Install Docker Engine and the Compose plugin from Docker's apt repository"
  osid="${os%% *}"
  run_or_print apt-get update -qq
  run_or_print apt-get install -y -qq ca-certificates curl gnupg openssl
  run_or_print install -m 0755 -d /etc/apt/keyrings
  run_or_print sh -c "curl -fsSL https://download.docker.com/linux/${osid}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
  run_or_print sh -c "echo \"deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${osid} \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list"
  run_or_print apt-get update -qq
  run_or_print apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run_or_print systemctl enable --now docker
else
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo present)"
fi

# 3. Configuration ------------------------------------------------------------------------------
step "3/8 Configuration"
prompt DOMAIN "Base domain (e.g. iot.example.com)" domain
prompt ADMIN_EMAIL "Super admin email" admin-email
[[ "$ADMIN_EMAIL" == *@*.* ]] || die "Invalid admin email: $ADMIN_EMAIL" 64
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "Invalid domain: $DOMAIN" 64
if [[ "$BUILD" == "1" ]]; then
  VERSION="$(cat "$SCRIPT_DIR/../VERSION")"
elif [[ -z "$VERSION" ]]; then
  VERSION="$(latest_release 2>/dev/null || true)"
  [[ -n "$VERSION" ]] || die "Could not determine the latest release (offline?). Pass --version." 64
fi
VERSION="${VERSION#v}"
ok "Domain $DOMAIN, version $VERSION"

# 4. Secrets --------------------------------------------------------------------------------------
step "4/8 Generating secrets"
mkdir -p "$PERSPICE_HOME" "$PERSPICE_HOME/backups"
umask 077
cat >"$PERSPICE_HOME/.env" <<ENV
PERSPICE_VERSION=$VERSION
PERSPICE_IMAGE_OWNER=$([[ "$BUILD" == "1" ]] && echo local || echo "${PERSPICE_REPO%%/*}")
BASE_DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
ACME_EMAIL=$ADMIN_EMAIL
POSTGRES_PASSWORD=$(gen_secret 24)
JWT_SECRET=$(gen_secret 48)
MASTER_KEY=$(openssl rand -base64 32)
INTERNAL_SECRET=$(gen_secret 32)
MQTT_INGEST_PASSWORD=$(gen_secret 24)
EMQX_API_KEY=perspice
EMQX_API_SECRET=$(gen_secret 32)
EMQX_DASHBOARD_PASSWORD=$(gen_secret 18)
BACKUP_PASSPHRASE=$(gen_secret 32)
MQTT_PLAIN_ENABLED=$MQTT_PLAIN
LOG_LEVEL=info
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:$ADMIN_EMAIL
STORAGE_DRIVER=$STORAGE
MQTT_TRANSPORT=$MQTT_MODE
ENV
if [[ "$STORAGE" == "s3" ]]; then
  printf 'S3_BUCKET=%s\nS3_REGION=%s\nS3_ENDPOINT=%s\n' "$S3_BUCKET" "${S3_REGION:-$AWS_REGION_VALUE}" "$S3_ENDPOINT" >>"$PERSPICE_HOME/.env"
fi
if [[ "$STORAGE" == "s3" || "$AWS_IOT" == "1" ]]; then
  printf 'AWS_REGION=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' "$AWS_REGION_VALUE" "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}" >>"$PERSPICE_HOME/.env"
fi
if [[ "$STORAGE" == "s3" && -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
  printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' "$AWS_ACCESS_KEY_ID" "${AWS_SECRET_ACCESS_KEY:-}" >>"$PERSPICE_HOME/.env"
fi
chmod 600 "$PERSPICE_HOME/.env"
umask 022
ok "Wrote $PERSPICE_HOME/.env (mode 600)"

# Deployment files: from this checkout, or from the release's source archive.
if [[ -d "$SCRIPT_DIR/../deploy" ]]; then
  src="$SCRIPT_DIR/.."
else
  src="$(mktemp -d)"
  run_or_print sh -c "curl -fsSL https://github.com/${PERSPICE_REPO}/archive/refs/tags/v${VERSION}.tar.gz | tar -xz -C '$src' --strip-components=1"
fi
run_or_print cp "$src/deploy/docker-compose.yml" "$src/deploy/docker-compose.aws.yml" "$PERSPICE_HOME/"
run_or_print cp -r "$src/deploy/emqx" "$src/deploy/cert-sync" "$src/deploy/monitoring" "$PERSPICE_HOME/"
run_or_print install -m 0755 "$src/scripts/perspice" /usr/local/bin/perspice
run_or_print install -d "$PERSPICE_HOME/scripts/lib"
run_or_print install -m 0755 "$src/scripts/update.sh" "$PERSPICE_HOME/scripts/update.sh"
run_or_print install -m 0644 "$src/scripts/lib/common.sh" "$PERSPICE_HOME/scripts/lib/common.sh"

# 5. Start ----------------------------------------------------------------------------------------
step "5/8 Starting Perspice"
if [[ "$BUILD" == "1" ]]; then
  run_or_print docker build -t "ghcr.io/local/perspice-server:$VERSION" -f "$src/deploy/Dockerfile.server" "$src"
  run_or_print docker build -t "ghcr.io/local/perspice-web:$VERSION" -f "$src/deploy/Dockerfile.web" "$src"
  run_or_print docker build -t "ghcr.io/local/perspice-renderer:$VERSION" -f "$src/deploy/Dockerfile.renderer" "$src"
else
  run_or_print compose pull --quiet
fi
if [[ "$AWS_IOT" == "1" ]]; then
  # Endpoint, policies and the ingest certificate; the command prints the .env lines to add.
  run_or_print install -d -m 0700 -o 1000 -g 1000 "$PERSPICE_HOME/aws"
  setup=(compose run --rm --no-deps -e MQTT_TRANSPORT=emqx -v "$PERSPICE_HOME/aws:/etc/perspice/aws" api
    node dist/cli.js aws-iot-setup --certs-dir /etc/perspice/aws --region "$AWS_REGION_VALUE")
  if [[ "$DRY_RUN" == "1" ]]; then
    run_or_print "${setup[@]}"
  else
    aws_env="$("${setup[@]}")" || die "AWS IoT Core setup failed (check the AWS credentials and IAM permissions in docs/aws.md)."
    while IFS='=' read -r key value; do [[ -n "$key" ]] && env_set "$key" "$value"; done <<<"$aws_env"
  fi
fi
# Web push keys, generated before the stack starts: restarting the API afterwards would cut the
# broker's connection to its authentication hook just as the install finishes.
if [[ "$DRY_RUN" == "1" ]]; then
  run_or_print compose run --rm --no-deps api node dist/cli.js vapid-keys
else
  while IFS='=' read -r key value; do [[ -n "$key" ]] && env_set "$key" "$value"; done < <(compose run --rm --no-deps -T api node dist/cli.js vapid-keys)
fi
run_or_print compose up -d
wait_healthy api 240 || die "The API did not become healthy. See: perspice logs api"
if [[ "$AWS_IOT" != "1" ]]; then
  wait_healthy emqx 180 || die "The MQTT broker did not become healthy. See: perspice logs emqx"
fi
ok "Services are healthy"

# 6. Super admin ----------------------------------------------------------------------------------
step "6/8 Creating the super admin"
if [[ -n "$SMTP_HOST" ]]; then
  run_or_print compose exec -T api node dist/cli.js configure-smtp --host "$SMTP_HOST" --port "$SMTP_PORT" \
    --user "$SMTP_USER" --pass "$SMTP_PASS" --from "${SMTP_FROM:-$ADMIN_EMAIL}"
fi
if [[ "$DRY_RUN" == "1" ]]; then
  run_or_print compose exec -T api node dist/cli.js create-admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"
else
  force=()
  [[ "$REINSTALL" == "1" ]] && force=(--force)
  admin_out="$(compose exec -T api node dist/cli.js create-admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" "${force[@]}" 2>&1)" || {
    printf '%s\n' "$admin_out" >&2
    [[ "$REINSTALL" == "1" ]] || die "Could not create the super admin."
  }
fi

# 7. Firewall -------------------------------------------------------------------------------------
step "7/8 Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ports=(80/tcp 443/tcp 443/udp)
  if [[ "$AWS_IOT" != "1" ]]; then
    ports+=(8883/tcp)
    [[ "$MQTT_PLAIN" == "true" ]] && ports+=(1883/tcp)
  fi
  for port in "${ports[@]}"; do run_or_print ufw allow "$port"; done
  ok "Opened ports ${ports[*]} in ufw"
elif [[ "$AWS_IOT" == "1" ]]; then
  info "ufw is not active; make sure ports 80 and 443 are reachable (devices connect to AWS IoT Core)."
else
  info "ufw is not active; make sure ports 80, 443, 8883$([[ "$MQTT_PLAIN" == "true" ]] && echo ' and 1883') are reachable."
fi

# 8. Summary --------------------------------------------------------------------------------------
# Devices must be able to connect when we say we're done: a message through the broker and back.
if [[ "$AWS_IOT" != "1" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    run_or_print compose exec -T api node dist/cli.js health --mqtt-roundtrip
  else
    mqtt_ok=0
    for _ in $(seq 1 24); do
      if compose exec -T api node dist/cli.js health --mqtt-roundtrip >/dev/null 2>&1; then mqtt_ok=1; break; fi
      sleep 5
    done
    [[ "$mqtt_ok" == "1" ]] || die "Devices can't use the MQTT broker yet. See: perspice logs emqx and perspice logs api"
  fi
  ok "MQTT round trip"
fi

step "8/8 Done"
cat <<SUMMARY

  Perspice IoT $VERSION is running.

  Web:   https://$DOMAIN   (customers: https://<slug>.$DOMAIN)
$(if [[ "$AWS_IOT" == "1" ]]; then echo "  MQTT:  AWS IoT Core, mqtts://$(env_get AWS_IOT_ENDPOINT):8883 (certificate per device)"; else echo "  MQTT:  mqtts://mqtt.$DOMAIN:8883$([[ "$MQTT_PLAIN" == "true" ]] && echo "   (plain: mqtt://mqtt.$DOMAIN:1883)")"; fi)

  DNS records needed: A $DOMAIN, A *.$DOMAIN and A mqtt.$DOMAIN → this server.

SUMMARY
if [[ -n "${admin_out:-}" ]]; then
  printf '  Super admin:\n    %s\n\n' "${admin_out//$'\n'/$'\n'    }"
fi
info "  Manage the installation with: perspice status | logs | restart | version"
