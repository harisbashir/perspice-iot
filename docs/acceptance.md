# Acceptance: success criteria for v1.0.0

How each success criterion of the design (§1.3) is verified, and the result for v1.0.0. "Every
release" means the check runs in CI on each tag; the numbers are from the v1.0.0 runs on
2026-10-13.

| # | Criterion | How it is verified | Result |
|---|---|---|---|
| 1 | A fresh Ubuntu/Debian server goes to a working HTTPS platform with one command | `deploy/test/install-e2e.sh --from HEAD` (every release): `install.sh` on a clean Ubuntu 24.04 with its own Docker daemon, then admin activation, 2FA, a customer, a device and MQTT telemetry; the installer only reports success once devices can connect | **Met.** See *Not covered* for public DNS and certificates |
| 2 | An ESP32 with the example sketch appears online within seconds; its telemetry shows live | The firmware examples compile for ESP32 and AVR in CI; devices speaking the same protocol (simulator, e2e MQTT clients) come online on connect and their values reach dashboards over websockets in the e2e suite (`core`, `live` specs) and the load test (p50 18 ms publish → browser) | **Met** for the protocol and the platform. See *Not covered* for physical boards |
| 3 | A silent device is marked offline after its timeout (±30 s) and recipients get email and in-app notifications | Integration tests `presence` (the sweep runs every 30 s: offline between the timeout and 30 s later) and `status-notifier` (email through Mailpit and in-app, flapping suppressed) | **Met** |
| 4 | One dashboard template serves every device of its profile across customers, each seeing only their devices | Integration tests (`dashboard-instances`, `dashboard-data`), the e2e `dashboards` spec (two customers, one template) | **Met** |
| 5 | A customer admin creates users with lower roles and can't see or affect other customers, verified by automated isolation tests | Integration tests `tenant-isolation`, `rbac` and the isolation cases in every resource's tests (devices, telemetry, alarms, dashboards, exports, assets, tariffs, OTA, websockets); the v1.0 security review closed the permission gaps it found ([security.md](security.md)) | **Met** |
| 6 | `update.sh` upgrades with an automatic pre-update backup and rolls back on a failed health check | `install-e2e.sh --from v0.1.0` and `--from v0.8.0` (every release): real upgrades with data, then an update whose migration step fails must roll back to the same version with the data intact; bats tests for each failure path | **Met** (upgrades from v0.1.0 and v0.8.0 and rollbacks pass) |
| 7 | `test.sh` passes on a clean checkout; `test.sh --live` passes against a running install | `scripts/test.sh` (unit 388, integration 413, e2e 36 across eight projects); `test.sh --live` run against a running stack (health, a temporary device, an MQTT round trip, cleanup) | **Met** |
| 8 | 10,000 simulated devices at 1 message per 10 s on 4 vCPU / 8 GB with p95 ingest-to-dashboard latency under 2 s | `deploy/test/loadtest.sh` ([load-test.md](load-test.md)) with two calculated formulas and a counter per message | **Met:** 1,000 msg/s for 15 minutes, 899,975 sent and stored (0 lost), p95 **95 ms** |

## What the release checks found

The release work found eleven defects, nine of them only by running the real scripts on a clean
server rather than against mocks, and two in the security review; all are fixed and covered by
tests (see the [CHANGELOG](../CHANGELOG.md)):
ingest losing about half of all messages for an hour after every restart, a deleted device jamming
the telemetry buffer, updates not applying the broker's new configuration, rollbacks hiding a
failed restore, the installer reporting success before devices could connect, `--reinstall`
replacing the secrets the data depends on, two database readiness problems on first boot, 0.x
backups refused on 1.0, and two permission gaps for custom roles.

## Not covered (verify after publishing)

- **Public DNS and Let's Encrypt certificates.** The install test serves `localhost` with Caddy's
  internal certificates. Install once on a real server with DNS records before announcing the
  release.
- **Installing from the published release** (pulling images from the registry, `install.sh`
  without `--build`): only possible once the release workflow has pushed the v1.0.0 images.
- **Physical ESP32 boards.** The library compiles in CI and the protocol is exercised end to end,
  but no board was flashed for this release.
- **Load tail.** At 1,000 msg/s on 4 shared cores the stack averages 338% CPU; p99 latency was
  3.2 s (p95 95 ms). For fleets near that size, use a larger server.
