# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
