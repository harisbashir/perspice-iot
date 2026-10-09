# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
