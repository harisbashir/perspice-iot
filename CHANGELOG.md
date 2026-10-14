# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] - 2026-10-14

### Added

- Help: articles for every page, opened from the Help button in the top bar. Customers get
  explanations of how the system works; platform users also get technical guides (device
  profiles, dashboard design, asset types, the device protocol, firmware, system and API) and
  boxed platform notes inside articles.
- Dashboard templates preview with sample data when no device (or asset) can fill them, instead
  of "This widget needs the dashboard to be opened for a device"; **Preview with** also offers
  *Sample data* next to real devices.

- Invite links to copy: after inviting a user, and from the menu of an invited user (which issues
  a fresh link; earlier ones stop working). Users can be onboarded on servers without email.
  API: the invite response carries `inviteLink`, and `POST /api/users/:id/invite-link` returns a
  new one.

### Fixed

- Settings tabs other than *My profile* redirected in a loop and the page flickered: their links
  were resolved under the current tab.

## [1.0.1] - 2026-10-13

Installs from the published images work, and a server can be installed on its IP address
without DNS records.

### Added

- Installs without DNS records: `install.sh --domain <IPv4>` serves the platform on the address's
  sslip.io name (customer subdomains included) and, for private addresses, uses local
  certificates.
- `install.sh --local-certs` (`LOCAL_CERTS=true`): certificates from Caddy's own authority, for
  servers the internet can't reach.
- Plain HTTP to any other name, such as the server's IP, redirects to the platform's address.

### Fixed

- Installs and updates from the published images failed: the installer pulled from a GitHub
  owner that doesn't exist, and `docker compose pull` tried to pull `cert-sync`, which is built
  on the server and never published. Images now come from `ghcr.io/harisbashir`, and `cert-sync`
  is built during install and update.

## [1.0.0] - 2026-10-13

The first stable release: every success criterion verified end to end
([acceptance.md](docs/acceptance.md)), the install and update scripts tested for real on a clean
Ubuntu (fresh installs, upgrades from v0.1.0 and v0.8.0, and automatic rollbacks), and a security
review ([security.md](docs/security.md)).

### Added

- `update.sh --source <dir|tar.gz>`: update installs built from source, or offline servers, from a
  source tree or release tarball. Updates also install the target's `update.sh` and CLI.
- `deploy/test/install-e2e.sh`: the real install and update path on a clean Ubuntu 24.04 (fresh
  install, upgrades from older releases, a failed update that must roll back); run for every
  release tag.
- `README.md`, upgrade notes for 0.x → 1.0 ([operations.md](docs/operations.md)), the acceptance
  record and the security guide.

### Fixed

- **Ingest after restarts:** ingest's persistent MQTT session was named after its container, so
  every update or restart left the old session behind for an hour and EMQX sent it about half of
  all device messages, which were lost. Ingest now has a stable id (`INGEST_ID`) and removes stale
  sessions on start-up.
- **Telemetry buffer:** a device deleted while its messages were in flight failed the whole batch
  (other devices' rows included), and its replay blocked the failover buffer for good. Rows of
  deleted devices are skipped, and a batch the database refuses for good is dropped and counted
  instead of blocking.
- **Updates:** infrastructure whose configuration changed is restarted first (EMQX never got the
  internal listener added in 0.4.0 when updating from older releases); EMQX and cert-sync are
  recreated so their file-based configuration applies; the health check is retried while ingest
  settles; rollbacks restore the database reliably (they acted on services the older release
  didn't have, and hid a failing restore) and report only once devices can connect.
- **Installs:** the installer no longer restarts the API at the very end (devices were refused for
  up to a minute after "Done") and waits for an MQTT round trip before reporting success;
  `--reinstall` keeps the secrets the existing data depends on (it replaced the database password,
  `MASTER_KEY` and `BACKUP_PASSPHRASE`); PostgreSQL counts as ready only when it answers over TCP;
  the database's first boot no longer depends on cgroup files (Docker inside LXC failed).
- **Backups:** 0.x backups restore on 1.0 (they were refused across major versions); backups are
  accepted back to v0.1.0 and migrated forward.
- **Security:** dashboard data and live subscriptions now check the widget's permissions, not only
  the viewer's scope (custom roles without `telemetry.read` or `alarm.read` could read through
  them); js-yaml updated.
- CI runs every e2e project and shellchecks every script; the simulator test no longer flakes
  under load.

## [0.8.0] - 2026-10-10

Asset hierarchy (sub-project 5d).

### Added

- **Asset types** (platform): name, icon, attributes (text, number, date) and a default asset
  dashboard.
- **Assets**: a tree per customer (sites containing equipment, up to 8 levels), scoped by customer
  and group like devices, with attributes from the type, an optional location, breadcrumbs, moves
  checked against loops and depth, and roll-ups per subtree (devices by status, open alarms by worst
  severity). Assets page with the tree; asset page with Dashboard, Devices, Sub-assets, Alarms and
  Details.
- **Devices on assets**: at most one asset per device, of the same customer; attach from the asset,
  the device page or in bulk; device and alarm lists filter by asset (subtree).
- **Asset dashboards**: templates for an asset type, served per customer like device dashboards; the
  data source "the dashboard's asset" (its devices, directly or in the whole subtree) for KPIs, maps,
  bar and pie charts, device lists and summed energy; alarm widgets limited to the asset.
- Docs: [assets.md](docs/assets.md).

## [0.7.0] - 2026-10-10

Calculated telemetry, energy and generators (sub-project 5c).

### Added

- **Calculated keys** per device profile, computed for every message before it is stored (so
  they chart, aggregate, alarm and export like any other key): **formulas** in a small, safe
  expression language (arithmetic, comparisons, logic, conditionals, `abs min max round floor ceil
  sqrt pow log exp clamp`; no code execution; size limits), **counter use** since the last reading
  (meter resets handled, implausible jumps dropped), **run time** of a running state, and **level
  drops** (fuel used, refuels ignored). Checked as you type in the profile editor, with a preview
  on one of the profile's devices. Calculated keys appear in every key picker.
- **Energy**: consumption and cost per hour, day, week (from Monday) or month in the customer's
  timezone (`GET /devices/:id/energy`), and the **Energy summary** widget (this day, week, month or
  year so far, or the time window; cost; change against the same point of the previous period;
  bars).
- **Tariffs** per customer with a platform default: currency, price per unit and time-of-use
  periods by weekday and hour (Settings → Energy tariff, permission `tariff.manage`).
- **Run hours** and a **service log** per device (Maintenance tab; permission `device.service` for
  customer admins and operators).
- Alarm rule type **Service due** (`maintenance_due`): an interval in run hours and/or days, with
  an optional earlier reminder; checked a minute after run time reports and hourly; cleared by
  logging a service.
- Simulator: keys ending in `_kwh`, `_wh` or `_total` rise like meters. The `GeneratorController`
  example reports an energy counter.
- Load test option `LOAD_CALCULATED` (on by default): two formulas and a counter delta per
  message.
- Docs: [energy.md](docs/energy.md).

## [0.6.0] - 2026-10-10

Fleet operations (sub-project 5b).

### Added

- **Firmware images** per device profile (Firmware page, permission `firmware.manage`): upload
  up to 16 MB with the version the firmware reports as `fw`; size and SHA-256 recorded.
- **OTA updates** with staged rollout: deploy a version to a profile's devices (optionally one
  customer's, with tags). The scheduler sends to online devices in batches, fails devices past the
  timeout, halts when more than the threshold of finished devices failed, and resends to devices
  that reconnect. A device is updated once it reports the new version. Update page with progress,
  halt reason, per-device states and cancel; Firmware tab on devices. Devices receive
  `perspice/v1/<id>/ota` (24-hour download link, SHA-256, size) and report
  `ota/progress`; HTTP devices use `/api/v1/device/ota`.
- **Firmware library OTA** on ESP32: HTTPS download into the inactive partition, SHA-256 checked
  before the image is committed, progress reports, restart; `firmwareVersion` reported as `fw` on
  every connect; the image is marked valid once it connects (rollback-safe). `OtaUpdate` example.
- **Claim codes**: unassigned devices created with a 12-character code (stored hashed); customer
  admins (`device.claim`) add a device by entering it. Single-use, same answer for every failure,
  10 attempts a minute.
- **CSV import** of up to 5,000 devices (profile, customer, group, tags, fixed location, claim
  code): checked row by row first, created in one transaction, credentials CSV offered once.
- **Bulk actions** on up to 500 selected devices: tags, group, assign to a customer, command,
  delete; per-device results and one audit entry.
- Simulator: `--fw <version>` and `--ota`.
- Docs: [fleet.md](docs/fleet.md).

### Fixed

- Claim codes in request bodies are redacted from the audit log.

## [0.5.0] - 2026-10-10

Location and fleet (sub-project 5a, the first part of the domain features).

### Added

- **Device locations**: fixed (set on the device's Location tab by clicking the map or typing
  coordinates) or reported by the device as telemetry (`lat`, `lng`, optional `speed`, `heading`,
  `acc`, `alt`; key names per profile). The newest fix by timestamp wins; invalid fixes (out of
  range, 0,0) go to the debug log. Live location updates over websockets.
- **Map widget**: devices coloured by status, clustered above 100, popups with chosen values and a
  link, geofence overlay, live movement; **route playback** for one device with a time slider,
  play/pause and its trips. The built-in overview gains a map. Tile server in Settings → Maps
  (default OpenStreetMap; the CSP follows `MAP_TILE_HOSTS`).
- **Trips**: detected per profile (start by movement or speed, end after standing; or by an
  ignition key), with figures computed from every stored fix and GPS jumps left out; trips tab with
  distance per day in the customer's timezone, export to XLSX/CSV/PDF.
- **Geofences**: circles and polygons per customer or platform-wide, drawn on a map; permission
  `geofence.manage`.
- **Geofence alarm rule**: device leaves (or enters) a geofence, with a clear margin against GPS
  jitter. A geofence in use by rules can't be deleted.
- `GpsTracker` firmware example (ESP32 + serial GPS); simulator `--mobile-share` for driving
  devices; the load test can include mobile devices (`LOAD_MOBILE_SHARE`).
- Docs: `location.md`.

### Fixed

- Ingest handles each device's MQTT messages in order, so a burst of buffered messages (e.g. a
  tracker back in coverage) keeps its order.
- Signing in after signing out goes to the overview instead of the page signed out from.

## [0.4.0] - 2026-10-09

Operations (sub-project 4).

### Added

- **Backups**: encrypted (AES-256-GCM, key from `BACKUP_PASSPHRASE`) archives of the database
  and stored files with a checksummed manifest; on demand or daily at a set time and timezone;
  written under a temporary name, verified and only then replacing the single kept backup; a
  failed backup keeps the previous one and alerts platform admins. `perspice backup [file]`.
- **Restore** from the System page or `perspice restore <file>`: the archive is checked
  (passphrase, checksums, version, `MASTER_KEY`) before anything changes, then restored in
  maintenance mode (API answers 503, the web shows a banner) into a side database that replaces
  the live one only on success; files are replaced and migrations run forward.
- **System page**: processes and their heartbeats, missing roles, message rate, connected
  devices, browser sessions, queues, database and storage size, backups and restore.
- **Prometheus metrics** on `/metrics` in every process (ingest results and rows, devices by
  status, open alarms, queues, websocket sessions, deliveries, Node.js process metrics) and an
  optional `monitoring` profile with Prometheus and a provisioned Grafana dashboard.
- **S3 storage** (`STORAGE_DRIVER=s3`, also S3-compatible services), with downloads through
  short-lived links signed by the API.
- **AWS IoT Core** as the device transport (`MQTT_TRANSPORT=aws-iot`): a thing and certificate
  per device (shown once, private key not kept), rotation on regenerate, removal on delete, a
  per-device policy; ingest over mutual TLS with lifecycle events for presence; commands through
  the data plane. `install.sh --mqtt=aws-iot --storage=s3`, `docker-compose.aws.yml` and
  `cli aws-iot-setup`; `DATABASE_URL` and `REDIS_URL` can point at managed services.
- **Load test** (`scripts/test.sh --load`): 10,000 simulated devices at one message every 10 s
  on a stack sharing 4 cores and 8 GB, checking rate, loss and latency. Result: 999.8 messages/s,
  none lost, p95 692 ms (`docs/load-test.md`).
- Docs: `backups.md`, `monitoring.md`, `aws.md`, `load-test.md`.

### Changed

- Ingest, Redis and PostgreSQL work per message cut for the load test: telemetry batches via
  `unnest()`, device ACLs returned at authentication, Redis auto-pipelining and AOF-only
  persistence, telemetry events on their own stream, `last_seen` and stored latest values
  refreshed once they lag (Redis keeps the exact values). Platform services use an internal EMQX
  listener with deep session queues, so a slow moment doesn't drop messages.
- The server image includes the PostgreSQL 16 client tools (`pg_dump`, `pg_restore`).
- `install.sh` generates `BACKUP_PASSPHRASE`; `update.sh` adds it to existing installs and takes
  a full backup before updating (from v0.4.0 on), besides the database snapshot used for rollback.
- The simulator creates devices in parallel, paces connections, reports per minute and writes a
  JSON summary.

## [0.3.0] - 2026-10-09

Alarms and notifications (sub-project 3).

### Added

- **Alarm rules** on a profile (every device, every customer), a customer, or a device, with
  opt-outs: threshold, range, duration, rate of change, state match, device status and no-data,
  each with a clear margin against flapping, severity, active schedule (timezone-aware),
  recipients (roles, users, groups) and channels. Customer admins manage their own rules.
- **Rules engine** in the `rules` role: evaluates every telemetry and status event, raises and
  clears alarms (one open alarm per rule and device, also with several workers), with duration
  and no-data timers on the scheduler.
- **Alarms**: list with live updates, filters, bulk acknowledge and export; detail with a
  timeline, acknowledge, clear and comments; a device Alarms tab; an unacknowledged count in the
  navigation.
- **Notifications**: a delivery pipeline with retries and a delivery log (with retry of dead
  letters); per-user preferences (email/push, minimum level, quiet hours with a critical bypass,
  timezone); digest emails for busy periods and after quiet hours; web push (VAPID) with a
  service worker; alarm raised/cleared emails.
- **Webhooks** for alarm and device-status events, signed with HMAC-SHA256, per customer or
  platform-wide, protected against SSRF (public https destinations only by default, checked
  again on connect, no redirects).
- **Scheduled reports**: dashboard PDFs and telemetry exports emailed daily, weekly or monthly
  in a timezone, run with the owner's current access, with 7-day download links.
- **Alarm widgets** (alarm table, active-alarms KPI, alarm timeline) and an `alarms` data
  source; the built-in overview gains alarm tiles and an open-alarms table.
- User and customer timezones; permissions `alarm.read`, `alarm.ack`, `alarm.rule.write`,
  `webhook.manage` and `report.schedule`.

### Changed

- Device status notifications now go through the delivery pipeline, so preferences, push,
  digests and the delivery log apply to them.

## [0.2.0] - 2026-10-08

Dashboards and widgets (sub-project 2).

### Added

- **Dashboard templates** per device profile, generated from a profile or built from scratch,
  with versioning, cloning onto other profiles with key mapping, and JSON import/export. One
  template serves every device of the profile across all customers.
- **Customer instances**: each customer gets its own copy; customer admins can customise it and
  re-sync when the template changes (the UI flags templates changed since customisation).
- **Builder**: drag-and-drop 12-column grid with multiple views, a widget library, per-widget
  data sources (current device, a device, devices of a profile, device lists) and settings
  forms generated from each widget's schema; live preview with a real device.
- **Widget library** (and a plugin SDK, see `docs/widgets.md`): time series, bar, pie, radial
  and linear gauges, heatmap, sparkline, value card, multi-value, LED, progress, battery, tank,
  KPI, latest-values / history / device tables, command button, toggle, slider, set-point,
  markdown and image overlay.
- **Live dashboards**: one data request per dashboard, scoped to the viewer, with per-widget
  errors; values and statuses update over the WebSocket (up to 500 devices per dashboard).
- **Overview dashboards** on both portals: live KPI tiles and the device table, with a customer
  column and filter for platform users.
- **Exports** to CSV, Excel and PDF from tables, charts, device history, the device list and the
  audit log. Up to 50,000 rows stream straight back; larger exports run in the background with
  an in-app notification and an `export_ready` email, owner-only download links, and 24-hour
  retention.
- **Dashboard PDF reports**, rendered by a new `renderer` service (headless Chromium, own image)
  through single-use render tokens.
- Permissions `dashboard.edit` (platform) and `dashboard.customize` (customer admins).

### Changed

- Device pages open on their dashboard; the static overview is replaced by the overview
  dashboard.
- `perspice update` installs the target release's `docker-compose.yml` (new services appear on
  upgrade) and restarts the new `renderer` service.

## [0.1.0] - 2026-10-08

First release: the core platform (sub-project 1).

### Added

- **Multi-tenant platform** with platform and customer scopes, customer groups, built-in and
  custom roles (no privilege escalation), API keys, and tenant isolation (cross-tenant access
  returns 404) enforced through a scoped repository and an automated isolation test suite.
- **White-labelling**: platform and per-customer branding (name, logos, colours with contrast
  check, custom CSS), customer subdomains with on-demand TLS certificates.
- **Authentication**: Argon2id passwords, rotating refresh tokens with reuse detection, account
  lockout, login rate limiting, invitations, password reset, TOTP two-factor (required for super
  admins), audit log.
- **Devices**: device profiles (telemetry keys, commands, presence timeouts, notifications),
  devices with token credentials, client/server/shared attributes, per-device debug log.
- **Connectivity**: MQTT through EMQX 5.8 with API-backed authentication and per-device topic
  ACLs; HTTP transport with rate limiting; sessions kicked when a device is deleted or its token
  regenerated.
- **Telemetry**: validation and timestamp repair, batched TimescaleDB writes with Redis
  failover buffer, continuous aggregates (1 min / 1 h / 1 day) chosen automatically by range,
  latest-value cache.
- **Presence**: online / offline / dead detection (MQTT session events plus a leader-elected
  inactivity sweep, sleepy devices, stale-disconnect protection) with email and in-app
  notifications.
- **Commands** over MQTT and HTTP long-poll with acknowledgement, timeouts and hold-until-online.
- **Web app**: branded login and auth flows, administration (customers, users, roles, branding,
  email, security, audit), device profiles, devices with live values, history charts,
  commands, attributes, credentials and debug view, notifications bell.
- **Deployment**: Docker images, Compose stack behind Caddy, `install.sh`, `update.sh` with
  pre-update snapshot and automatic rollback, `perspice` management command, `test.sh`.
- **Tooling**: device simulator with latency measurement, `PerspiceClient` Arduino/ESP32
  library with examples, OpenAPI docs, CI (lint, typecheck, unit, integration, e2e, smoke,
  scripts, firmware) and a release workflow publishing images to GHCR.
