# Perspice IoT

A self-hosted, white-label IoT platform for monitoring and controlling devices: telemetry and
commands over MQTT or HTTP, dashboards, alarms and notifications, locations and trips, firmware
updates, energy and generator monitoring, and an asset hierarchy, for many customers on one
installation, each on its own subdomain with its own branding.

It runs as a Docker Compose stack on one Linux server (or with AWS IoT Core and S3), and comes with
an Arduino/ESP32 library for devices.

## Quick start

On an Ubuntu 22.04+ or Debian 12+ server with DNS for `iot.example.com`, `*.iot.example.com` and
`mqtt.iot.example.com` pointing at it:

```bash
git clone https://github.com/perspice/perspice-iot.git
cd perspice-iot
sudo scripts/install.sh --domain iot.example.com --admin-email you@example.com
```

Open the activation link the installer prints, set your password and enrol two-factor
authentication. Then create a device profile and a device, flash the `BasicSensor` example with the
device's credentials, and watch its values arrive. Updates: `sudo perspice update`.

## What's in it

| | |
|---|---|
| Devices | profiles, credentials, MQTT/HTTP/AWS IoT Core, commands, presence, debug log, calculated keys |
| Customers | tenants with subdomains, branding, groups, roles and permissions, claim codes |
| Dashboards | templates per profile or asset type, 28 widgets, live updates, PDF reports, exports |
| Alarms | rule engine (thresholds, durations, geofences, maintenance…), email, web push, webhooks, digests |
| Fleet | maps, trips, geofences, OTA firmware with staged rollout, bulk operations, CSV import |
| Energy | consumption and cost with tariffs, generator run hours and service reminders |
| Assets | sites and equipment with roll-ups and asset dashboards |
| Operations | backups and restore, updates with automatic rollback, monitoring, load-tested to 10,000 devices |

## Documentation

| Topic | |
|---|---|
| [Installing](docs/install.md) | requirements, DNS, options, AWS ([aws.md](docs/aws.md)) |
| [Operating](docs/operations.md) | updates, backups ([backups.md](docs/backups.md)), monitoring ([monitoring.md](docs/monitoring.md)), [security](docs/security.md) |
| [Devices](docs/device-protocol.md) | the protocol, the [firmware library](docs/firmware.md), [fleet operations](docs/fleet.md) |
| [Dashboards](docs/dashboards.md) | the builder, [writing widgets](docs/widgets.md) |
| [Alarms](docs/alarms.md) | rules and notifications |
| [Locations](docs/location.md), [energy](docs/energy.md), [assets](docs/assets.md) | domain features |
| [Load test](docs/load-test.md), [acceptance](docs/acceptance.md) | how the success criteria were verified |

The REST API is documented at `/api/docs` on every installation.

## Development

A pnpm monorepo: `apps/server` (NestJS), `apps/web` (React), `apps/simulator`, `packages/shared`,
`packages/widgets`, `firmware/PerspiceClient`, `e2e` (Playwright), `deploy` (Compose, Caddy,
EMQX), `scripts` (install, update, CLI).

```bash
corepack pnpm install
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test:unit
scripts/test.sh            # unit, integration and end-to-end suites (needs Docker)
```

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
