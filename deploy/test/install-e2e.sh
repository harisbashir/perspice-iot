#!/usr/bin/env bash
# The real install and update path (success criteria 1 and 6), on a clean Ubuntu 24.04 in a
# privileged container with its own Docker daemon: install an old release with install.sh
# --build, add data, update to this checkout with update.sh --source, check the data survived
# and the new version works, then update to a deliberately broken build and check it rolls back
# with the data intact.
# Usage: deploy/test/install-e2e.sh [--from v0.1.0 | --from HEAD]   (needs docker and git)
#   --from HEAD installs this checkout with its own install.sh (no upgrade step).
#   DOMAIN=<IPv4> (with --from HEAD) installs on the address, served on its sslip.io name.
#   KEEP=1 leaves the container running (docker exec -it perspice-install-e2e bash).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FROM="v0.1.0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    *) echo "Usage: $0 [--from vX.Y.Z]" >&2; exit 64 ;;
  esac
done
NAME="perspice-install-e2e"
WORK="$(mktemp -d)"
log() { printf '\n==> %s\n' "$*"; }
cleanup() {
  if [[ "${KEEP:-}" == "1" ]]; then
    echo "Kept: docker exec -it $NAME bash (its /work is $WORK)"
    return
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$NAME-docker" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

log "Packing $FROM and this checkout ($(git -C "$ROOT" rev-parse --short HEAD))"
git -C "$ROOT" archive --format=tar.gz --prefix=old/ "$FROM" >"$WORK/from.tar.gz"
git -C "$ROOT" archive --format=tar.gz --prefix=new/ HEAD >"$WORK/current.tar.gz"
cp "$ROOT/deploy/test/install-e2e.inner.sh" "$WORK/inner.sh"

log "Starting a clean Ubuntu 24.04 host"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker build -q -t perspice-install-host - >/dev/null <<'DOCKERFILE'
FROM ubuntu:24.04
RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 docker-buildx curl jq openssl ca-certificates mosquitto-clients iproute2 >/dev/null \
 && rm -rf /var/lib/apt/lists/*
DOCKERFILE
# The inner daemon keeps its images on a volume (overlay2 can't sit on the container's own overlay).
docker run -d --name "$NAME" --privileged -v "$NAME-docker:/var/lib/docker" -v "$WORK:/work" perspice-install-host sleep infinity >/dev/null

docker exec -e DOMAIN="${DOMAIN:-localhost}" "$NAME" bash /work/inner.sh
