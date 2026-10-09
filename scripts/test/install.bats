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

@test "dry run for AWS writes S3 and IoT Core settings and runs the IoT Core setup" {
  install_docker_stub
  AWS_ACCESS_KEY_ID=AKIAEXAMPLE AWS_SECRET_ACCESS_KEY=secret run bash "$SCRIPTS/install.sh" --dry-run --non-interactive \
    --domain example.com --admin-email admin@example.com --version 0.4.0 \
    --storage=s3 --s3-bucket perspice-files --s3-region eu-west-1 --mqtt=aws-iot
  [ "$status" -eq 0 ]
  grep -q '^STORAGE_DRIVER=s3$' "$PERSPICE_HOME/.env"
  grep -q '^S3_BUCKET=perspice-files$' "$PERSPICE_HOME/.env"
  grep -q '^S3_REGION=eu-west-1$' "$PERSPICE_HOME/.env"
  grep -q '^S3_ACCESS_KEY_ID=AKIAEXAMPLE$' "$PERSPICE_HOME/.env"
  grep -q '^MQTT_TRANSPORT=aws-iot$' "$PERSPICE_HOME/.env"
  grep -q '^AWS_REGION=eu-west-1$' "$PERSPICE_HOME/.env"
  [[ "$output" == *"aws-iot-setup --certs-dir /etc/perspice/aws --region eu-west-1"* ]]
  [[ "$output" != *"8883/tcp"* ]]
}

@test "defaults to local storage and EMQX" {
  install_docker_stub
  run bash "$SCRIPTS/install.sh" --dry-run --non-interactive --domain example.com --admin-email admin@example.com --version 0.4.0
  [ "$status" -eq 0 ]
  grep -q '^STORAGE_DRIVER=local$' "$PERSPICE_HOME/.env"
  grep -q '^MQTT_TRANSPORT=emqx$' "$PERSPICE_HOME/.env"
  ! grep -q '^AWS_REGION=' "$PERSPICE_HOME/.env"
  [[ "$output" != *"aws-iot-setup"* ]]
}

@test "S3 storage needs a bucket, and unknown modes are refused" {
  run bash "$SCRIPTS/install.sh" --dry-run --non-interactive --domain example.com --admin-email admin@example.com --version 0.4.0 --storage=s3
  [ "$status" -eq 64 ]
  [[ "$output" == *"--s3-bucket"* ]]
  run bash "$SCRIPTS/install.sh" --dry-run --non-interactive --domain example.com --admin-email admin@example.com --version 0.4.0 --mqtt=mosquitto
  [ "$status" -eq 64 ]
}
