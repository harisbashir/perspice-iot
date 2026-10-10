#!/usr/bin/env bats

load helpers

setup() {
  setup_home
  install_docker_stub
  write_env 0.4.0
}

@test "backup asks the server for a backup and writes it to the given file" {
  run bash "$SCRIPTS/perspice" backup "$BATS_TEST_TMPDIR/out.pbk"
  [ "$status" -eq 0 ]
  grep -q 'exec -T api node dist/cli.js backup --out -' "$STUB_LOG"
  [ -f "$BATS_TEST_TMPDIR/out.pbk" ]
  [ "$(stat -c %a "$BATS_TEST_TMPDIR/out.pbk")" = "600" ]
}

@test "a failed backup leaves no file behind" {
  STUB_FAIL_ON="cli.js backup" run bash "$SCRIPTS/perspice" backup "$BATS_TEST_TMPDIR/out.pbk"
  [ "$status" -eq 1 ]
  [ ! -e "$BATS_TEST_TMPDIR/out.pbk" ]
}

@test "restore streams the file to the server and refuses missing files" {
  echo "PSPBK1..." >"$BATS_TEST_TMPDIR/in.pbk"
  run bash "$SCRIPTS/perspice" restore "$BATS_TEST_TMPDIR/in.pbk"
  [ "$status" -eq 0 ]
  grep -q 'exec -T api node dist/cli.js restore -' "$STUB_LOG"
  run bash "$SCRIPTS/perspice" restore "$BATS_TEST_TMPDIR/missing.pbk"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]]
}
