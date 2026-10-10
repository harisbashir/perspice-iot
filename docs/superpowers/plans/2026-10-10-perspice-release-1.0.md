# Perspice IoT — Sub-project 6: Release 1.0 Hardening Plan

> **For agentic workers:** execute task by task. Each task is test-first where it adds behaviour, and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.0.0: every success criterion (spec §1.3) demonstrated end to end and recorded, the install and update scripts exercised for real (not only with mocks) including upgrades from v0.1.0 and an automatic rollback, a security review with its findings fixed, CI covering the whole suite, and documentation an operator can start from.

**Architecture:** no new product features. New test harness `deploy/test/install-e2e.sh` runs the real `install.sh` and `update.sh` in a privileged Ubuntu 24.04 container with its own Docker daemon. `update.sh` gains `--source` so locally built installations can update (found while planning: they couldn't).

**Spec:** §1.3 (success criteria 1–8), §9 (security), §10.4 (scripts), §10.5 (versioning).

## Findings that shaped the plan

- `update.sh` always pulls images from the registry and fetches deploy files from GitHub: an installation made with `install.sh --build` (offline, air-gapped, or from a checkout) can't be updated, and the update path has only ever run against mocks.
- CI's e2e job still stops at the `alarms` project (v0.3.0); `shellcheck` skips the newer scripts.
- The simulator's latency test is flaky under full-suite load.

## Scope

| Item | Decision |
|---|---|
| `update.sh --source <dir\|tarball>` | Build the target's images and take its deploy files from a source tree instead of the registry and GitHub; the version comes from its `VERSION`. Covered by bats with mocks, and for real by the harness. |
| Real install/update harness | `deploy/test/install-e2e.sh`: a privileged `ubuntu:24.04` container with Docker Engine; installs **v0.1.0** from its tag (`git archive`) with `--build`, seeds data (admin, customer, device, telemetry over MQTT), runs `update.sh --source` to the current tree, checks data, health and an MQTT round trip, runs `test.sh --live` against it; then an update to a deliberately broken build must roll back (version and data intact). A second run starts from v0.8.0. |
| Security review | A written checklist over auth and sessions, tenancy, input handling, files and uploads, headers and CSP, secrets, rate limits, containers (users, capabilities), dependencies (`pnpm audit`), device credentials and MQTT ACLs. Each finding fixed with a test or documented with its reason. `docs/security.md`. |
| CI | e2e through `assets`; `shellcheck` over every script; the install harness on release tags. |
| Flaky test | The simulator latency test asserts what it measures without timing assumptions that fail under load. |
| Acceptance record | `docs/acceptance.md`: each success criterion, how it is verified, and the result for v1.0.0 (with the load-test numbers). |
| Docs | `README.md` (what it is, quick start, links), a docs index, upgrade notes for 0.x → 1.0. |

## Tasks

## Task 1: CI and the flaky test
- [ ] e2e job through `assets`; shellcheck every script (`scripts/`, `deploy/`); simulator test made robust. Commit `ci: cover the whole suite`.

## Task 2: `update.sh --source`
- [ ] Bats tests first (build from a tree, version from it, deploy files from it, rollback unchanged); implementation; `perspice update` passes it through. Commit `feat(scripts): update from a source tree`.

## Task 3: Real install and update harness
- [ ] `deploy/test/install-e2e.sh` as above; fix whatever it finds in `install.sh`/`update.sh`/migrations. Commit `test(scripts): real install, upgrade and rollback`.

## Task 4: Security review
- [ ] Checklist, findings, fixes with tests; `docs/security.md`. Commits per fix (`fix(security): …`), then `docs: security`.

## Task 5: Docs and acceptance
- [ ] `README.md`, docs index, upgrade notes, `docs/acceptance.md`.

## Task 6: Release v1.0.0
- [ ] Full checks, e2e, smoke, install harness, load test; `VERSION` 1.0.0, CHANGELOG, annotated tag `v1.0.0` (local; the user pushes). After publishing: install from the GitHub release on a fresh server (the one path only a real release can test).
