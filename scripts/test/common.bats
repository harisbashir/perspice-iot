#!/usr/bin/env bats

setup() {
  # shellcheck source=../lib/common.sh
  source "$BATS_TEST_DIRNAME/../lib/common.sh"
  FIX="$BATS_TEST_DIRNAME/fixtures"
}

@test "detect_os accepts Ubuntu 22.04 and 24.04 and Debian 12" {
  run detect_os "$FIX/ubuntu-22.04"
  [ "$status" -eq 0 ] && [ "$output" = "ubuntu 22.04" ]
  run detect_os "$FIX/ubuntu-24.04"
  [ "$status" -eq 0 ]
  run detect_os "$FIX/debian-12"
  [ "$status" -eq 0 ] && [ "$output" = "debian 12" ]
}

@test "detect_os rejects CentOS and Ubuntu 20.04" {
  run detect_os "$FIX/centos-9"
  [ "$status" -ne 0 ]
  run detect_os "$FIX/ubuntu-20.04"
  [ "$status" -ne 0 ]
}

@test "version_gt compares semantic versions" {
  version_gt 0.2.0 0.1.9
  version_gt v1.10.0 1.9.3
  ! version_gt 0.1.0 0.1.0
  ! version_gt 0.1.9 0.2.0
}

@test "env_set updates and appends keys, keeping mode 600" {
  f="$BATS_TEST_TMPDIR/.env"
  printf 'A=1\nB=2\n' >"$f"
  env_set B 3 "$f"
  env_set C 4 "$f"
  [ "$(env_get B "$f")" = "3" ]
  [ "$(env_get C "$f")" = "4" ]
  [ "$(stat -c %a "$f")" = "600" ]
}

@test "gen_secret produces distinct url-safe values" {
  a="$(gen_secret 24)"
  b="$(gen_secret 24)"
  [ "$a" != "$b" ]
  [[ "$a" =~ ^[A-Za-z0-9]+$ ]]
}
