# Common setup for the script tests: an isolated PERSPICE_HOME and a stub `docker` on PATH.
SCRIPTS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup_home() {
  export PERSPICE_HOME="$BATS_TEST_TMPDIR/home"
  export STUB_LOG="$BATS_TEST_TMPDIR/calls.log"
  export PERSPICE_SKIP_ROOT_CHECK=1
  mkdir -p "$PERSPICE_HOME" "$BATS_TEST_TMPDIR/bin"
  : >"$STUB_LOG"
}

# A PATH with the real tools we need but without docker (simulates a fresh machine).
path_without_docker() {
  local dir="$BATS_TEST_TMPDIR/nodocker"
  mkdir -p "$dir"
  for tool in bash sh env cat sed awk grep tr head tail cut sort mkdir chmod cp rm mv mktemp date dirname basename \
    openssl nproc df id uname printf tee find install readlink seq ls touch wc true false; do
    local real
    real="$(command -v "$tool" 2>/dev/null)" && ln -sf "$real" "$dir/$tool"
  done
  echo "$dir"
}

# A docker stub that records every call. STUB_FAIL_ON=<pattern> makes matching calls fail.
install_docker_stub() {
  cat >"$BATS_TEST_TMPDIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
if [[ -n "${STUB_FAIL_ON:-}" && "$*" == *"$STUB_FAIL_ON"* ]]; then exit 1; fi
case "$*" in
  *"ps -q"*) echo "cid-1" ;;
  *inspect*) echo "healthy" ;;
  *pg_dump*) echo "PGDMP fake dump" ;;
  *"backup --out -"*) echo "PSPBK1 fake backup" ;;
  "compose version"*) echo "Docker Compose version v2" ;;
esac
exit 0
STUB
  chmod +x "$BATS_TEST_TMPDIR/bin/docker"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

write_env() {
  cat >"$PERSPICE_HOME/.env" <<ENV
PERSPICE_VERSION=${1:-0.1.0}
PERSPICE_IMAGE_OWNER=perspice
BASE_DOMAIN=example.com
ENV
  chmod 600 "$PERSPICE_HOME/.env"
  touch "$PERSPICE_HOME/docker-compose.yml"
}
