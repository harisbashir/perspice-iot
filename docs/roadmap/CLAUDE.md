# docs/roadmap: how to resume the planned work

You are picking up a roadmap agreed with the maintainer on 2026-10-19. Read `ROADMAP.md` first: the
phase table (with status), the order, and the **compatibility contract**, which every phase must
follow (the system has to work fully between any two upgrades).

## Starting a phase

1. Check the status column in `ROADMAP.md` and `git log` for phases already done. Ask the
   maintainer which phase to do next if it isn't obvious; don't start two at once.
2. Read the phase's plan in full, then re-check every file and API it names against the code: the
   plans were written against v1.1.0 (commit `f13db1b`), and things move. Where a plan says
   "verify", do that first and adjust the plan if reality differs (say so in the PR).
3. Branch from `master` (`feat/<phase-name>`), work task by task, test-first where the plan has
   tests, one commit per task or a few per phase.
4. Repo guides apply: root `CLAUDE.md`, `apps/web/CLAUDE.md` (UI: design tokens, phone layouts,
   demo mode, screenshots), `firmware/CLAUDE.md` (library: build, CI, flash budget, threading).
5. UI work: add demo data for the feature in `apps/web/src/demo/` and look at it at phone and desktop
   width with `e2e/screenshots.mjs` before opening the PR.

## Finishing a phase

1. Typecheck, lint, unit tests locally; firmware examples compile (`firmware/CLAUDE.md`).
2. Update docs in the same PR: `docs/` (user docs), `docs/device-protocol.md` for any protocol
   change, the in-app help (`apps/web/src/help/content`), `firmware/PerspiceClient/CLAUDE.md` for
   library API changes, and `CHANGELOG.md` under `[Unreleased]`.
3. Open a PR; the maintainer decides when to merge. Release as the plan says (platform release PR,
   or a `firmware-vX.Y.Z` tag), only when asked.
4. Set the phase's status in `ROADMAP.md` to `done (vX.Y.Z)` and tick its tasks in the plan.
5. Hardware: list the plan's bench checklist in the PR for the maintainer; nothing in CI runs on
   real devices, so don't call a hardware path tested until they report back.

## Environment notes

The maintainer develops in a VM (no Docker, no system Node; integration and e2e run in CI) and
keeps a copy of the repo in a Windows share. Their test server runs an installed Perspice
(`sudo perspice update` after a release). The memory files for this project have the details.

## Plan files

| File | Phase |
|---|---|
| `01-alarm-snooze.md` | silence alarms during site visits |
| `02-update-windows.md` | OTA time windows, device veto, the `caps` attribute |
| `03-device-health.md` | `sys.*` readings and the Health tab |
| `04-logs-and-crash-reports.md` | log upload on request, ESP32 core dumps |
| `05-wifi-setup-portal.md` | SoftAP setup page in the library |
| `06a`–`06d` | multi-component firmware: platform, large downloads, library (Nextion, ATmega, storage), releases |
| `07a`, `07b` | SIM800 cellular link, platform side |
| `08a`–`08c` | Modbus maps, library poller, presets |
