#!/usr/bin/env bats
# Validates the compose files with the real Docker Compose (skipped where it isn't installed).

bats_require_minimum_version 1.5.0

DEPLOY="$BATS_TEST_DIRNAME/../../deploy"

# Evaluates a Python expression over the compose JSON in $output (bound to `c`).
q() { python3 -c "import json,sys; c=json.load(sys.stdin); print($1)" <<<"$output"; }

setup() {
  docker compose version >/dev/null 2>&1 || skip "docker compose not available"
  export ACME_EMAIL=admin@example.com POSTGRES_PASSWORD=x MQTT_TRANSPORT=aws-iot
}

@test "the AWS override is valid and leaves out the broker" {
  run --separate-stderr docker compose -f "$DEPLOY/docker-compose.yml" -f "$DEPLOY/docker-compose.aws.yml" config --services
  [ "$status" -eq 0 ]
  [[ "$output" == *ingest* ]]
  [[ "$output" != *emqx* ]]
  [[ "$output" != *cert-sync* ]]
  run --separate-stderr docker compose -f "$DEPLOY/docker-compose.yml" -f "$DEPLOY/docker-compose.aws.yml" config --format json
  [ "$status" -eq 0 ]
  [ "$(q "sorted(c['services']['ingest']['depends_on'])")" = "['migrate']" ]
  [ "$(q "[v.get('read_only') for v in c['services']['ingest']['volumes'] if v['target'] == '/etc/perspice/aws']")" = "[True]" ]
}

@test "managed database and Redis URLs replace the bundled ones" {
  run --separate-stderr env DATABASE_URL=postgres://u:p@tsdb.example:5432/perspice REDIS_URL=rediss://cache.example:6379 \
    docker compose -f "$DEPLOY/docker-compose.yml" config --format json
  [ "$status" -eq 0 ]
  [ "$(q "c['services']['api']['environment']['REDIS_URL']")" = "rediss://cache.example:6379" ]
  [ "$(q "c['services']['api']['environment']['DATABASE_URL']")" = "postgres://u:p@tsdb.example:5432/perspice" ]
}
