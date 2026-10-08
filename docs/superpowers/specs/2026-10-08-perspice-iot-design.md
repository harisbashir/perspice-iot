# Perspice IoT — Platform Design Spec

- **Date:** 2026-10-08
- **Status:** Approved design, pending written-spec review
- **Owner/maintainer:** Claude (Claude Code), for Haris

---

## 1. Purpose & Context

Perspice IoT is a white-label, multi-tenant platform for monitoring and controlling remote IoT devices, comparable in scope to ThingsBoard. A managing company (the *platform operator*) runs it, onboards customers, assigns devices to them, and designs dashboards per device type. Customers log in to their own branded portal with their own users and roles.

Target device classes: telecom remote monitoring & control (RMS) for generators/sites, energy metering, remote solar sites, fleet tracking. Primary hardware: ESP32 and Arduino boards with Ethernet modules (W5100/W5500/LAN8720), with Wi-Fi also supported.

### 1.1 Stated requirements (from the user)

| # | Requirement |
|---|---|
| R1 | White-label: logo and colour options per deployment |
| R2 | Runs on AWS, on local servers, or elsewhere; file storage on S3 (or similar) or local disk |
| R3 | MQTT and HTTP device connectivity (ESP32/Arduino with Ethernet) |
| R4 | Company admins manage the platform; customers get their own logins and role-based accounts (Admin → Customers → customer admins & viewers) |
| R5 | One install script, one update script, one test script; everything version controlled |
| R6 | Install script installs all dependencies, including an MQTT broker (a bundled broker is fine) |
| R7 | MQTT must be scalable and reliable, with an AWS IoT Core option |
| R8 | Email for forgot-password, account creation, device alarms and updates |
| R9 | Dashboard templates per device type, reusable across customers, clonable to other device types |
| R10 | Main overview dashboard on both portals showing major device details (online/offline etc.) |
| R11 | Versatile widgets; export all data types to Excel and PDF |
| R12 | Optional location tagging: manual, or reported by mobile devices |
| R13 | Keep only the most recent backup on the server; download and upload backups |
| R14 | Additional industry-standard features for remote monitoring |
| R15 | Configurable no-response period after which a device is deemed offline/dead (devices that wake briefly) |

### 1.2 Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Scale | 1,000–10,000 devices; design for about 1,000 msg/s sustained |
| Stack | TypeScript end to end: NestJS backend, React frontend, shared types |
| Maintainer | Claude maintains the codebase |
| Hosting | Ubuntu 22.04+/Debian 12+, Docker Compose packaging |
| Firmware | No existing format; we define the Perspice protocol and ship an Arduino/ESP32 library |
| White-label depth | Per installation **and** per customer (logo, colours, optional subdomain) |
| Alarm channels (v1) | Email, in-app (bell icon and toasts), browser push; pluggable channel interface for SMS/WhatsApp later |
| Architecture | Modular monolith with role-split processes (API / ingest / rules / scheduler) |

### 1.3 Success criteria

1. A fresh Ubuntu/Debian server goes from nothing to a working HTTPS platform with one command (`install.sh`).
2. An ESP32 running the example sketch appears online within seconds of being given credentials, and its telemetry shows on the dashboard live.
3. A device that stops sending data is marked Offline after its configured timeout (±30 s), and the configured recipients get an email and an in-app notification.
4. One dashboard template serves every device of its profile across multiple customers, and each customer sees only their own devices.
5. A customer admin can create users with lower roles and cannot see or affect other customers' data, verified by automated tenant-isolation tests.
6. `update.sh` upgrades a running install with automatic pre-update backup and rollback on failed health check.
7. `test.sh` passes on a clean checkout; `test.sh --live` passes against a running install.
8. The system sustains 10,000 simulated devices at 1 message per 10 s (about 1,000 msg/s) on a single 4 vCPU / 8 GB server with p95 ingest-to-dashboard latency under 2 s.

---

## 2. Architecture

### 2.1 Overview

```
 ESP32/Arduino ──MQTT(S)──► EMQX ─┐               ┌─► PostgreSQL + TimescaleDB
 ESP32/Arduino ──HTTP(S)──► API ──┤               │
 (alt) AWS IoT Core ──────────────┤               │
                                  ▼               │
                         Ingest Worker(s) ────────┼─► Redis (live state, queues, pub/sub)
                                  │               │
                                  ▼               │
                         Rules/Alarm Worker ──────┤─► Notification jobs (email/in-app/push)
                                  │               │
                    Scheduler (offline sweep, ────┘─► Storage (local disk | S3-compatible)
                    backups, retention, reports)
                                  ▲
 Browser (React SPA) ◄─HTTPS/WSS─ API Server ◄── Caddy (auto-TLS, customer subdomains)
```

### 2.2 Process roles

A single NestJS codebase runs as a different role depending on `PERSPICE_ROLE`:

| Role | Responsibility | Scaling |
|---|---|---|
| `api` | REST API, WebSocket gateway (live data and notifications), HTTP device ingest, auth, EMQX auth/ACL webhook | Horizontal (stateless; sticky sessions not required, WS fan-out via Redis pub/sub) |
| `ingest` | MQTT shared subscription (`$share/ingest/perspice/v1/+/#`), payload validation, device resolution, batched telemetry inserts, latest-value cache, event emission | Horizontal (shared subscription spreads messages across workers) |
| `rules` | Consumes the device event stream; evaluates alarm rules; creates/updates/clears alarms; queues notifications | Horizontal (partition by device id hash through BullMQ groups) |
| `scheduler` | Offline/dead sweep, backups, retention, scheduled reports, notification digests, export jobs | Single active instance (Redis lock for leader election) |

### 2.3 Infrastructure components

| Component | Choice | Notes |
|---|---|---|
| Reverse proxy | Caddy 2 | Automatic Let's Encrypt; wildcard subdomain via DNS-01 when configured, else on-demand TLS for customer subdomains |
| MQTT broker | EMQX 5 (open-source) | Clusterable; HTTP auth/ACL hook to `api`; client connect/disconnect events via webhook; TLS 8883; WebSocket MQTT 8084 |
| Database | PostgreSQL 16 + TimescaleDB | Relational data and time-series hypertables |
| Cache/queues | Redis 7 + BullMQ | Latest values, device presence, job queues, pub/sub, rate-limit counters, locks |
| Object storage | Driver: local filesystem or S3-compatible | Optional bundled MinIO for local S3 semantics |
| Email | Driver: SMTP or AWS SES | Queued with retries |
| Frontend | React 18 + Vite + TypeScript, TanStack Query, react-grid-layout, ECharts, Leaflet, shadcn/ui + Tailwind | Served as static build by Caddy |

### 2.4 Repository layout (monorepo, pnpm workspaces)

```
perspice-iot/
  apps/
    server/            NestJS app (all roles)
    web/               React SPA
    simulator/         CLI device simulator / load generator
  packages/
    shared/            Shared TS types, zod schemas, permission constants, protocol definitions
    widgets/           Widget plugin SDK and built-in widgets
  firmware/
    PerspiceClient/    Arduino library (library.properties, src/, examples/)
  deploy/
    docker-compose.yml
    docker-compose.aws.yml   overrides for external RDS/ElastiCache/S3/IoT Core
    caddy/ emqx/ postgres/
  scripts/
    install.sh  update.sh  test.sh  lib/
  docs/
  CHANGELOG.md  VERSION
```

---

## 3. Tenancy, Roles and Permissions (R4)

### 3.1 Hierarchy

```
Platform (operator company)
 ├─ Platform users: Super Admin · Admin · Support (read-only, can impersonate with audit)
 └─ Customers (tenants) — each with optional branding/subdomain
      ├─ (optional) Customer Groups / sites — nested, for scoping users to subsets of devices
      ├─ Customer Admin    — manage own users, devices' metadata, own alarm rules (if allowed), view/clone dashboards (if allowed)
      ├─ Customer Operator — view, send commands, acknowledge alarms
      └─ Customer Viewer   — read-only
```

### 3.2 Permission model

- Permissions are string constants in `packages/shared` (e.g. `device.read`, `device.write`, `device.command`, `alarm.ack`, `alarm.rule.write`, `dashboard.edit`, `export.data`, `user.manage`, `customer.manage`, `branding.edit`, `backup.manage`, `system.settings`).
- Built-in roles are fixed permission sets. Platform admins can define **custom roles** at platform scope (usable by any customer) or customer scope.
- **Escalation guard:** a user may only grant roles whose permission set is a subset of their own.
- Every user has a `scope`: `platform` or `customer:{id}`, optionally narrowed to `group:{id}` subtrees.

### 3.3 Isolation enforcement

- Every customer-owned table carries `customer_id` (nullable only for platform-owned objects like templates and profiles).
- All data access goes through a **scoped repository layer** that injects the request's tenant scope into every query; route handlers never build unscoped queries for tenant data.
- An automated **tenant-isolation test suite** exercises every list/get/update/delete endpoint as a user of customer A against customer B's objects and asserts 404.
- Platform users with `Support` role can **impersonate** a customer user; impersonation is time-limited and fully audit-logged.

---

## 4. Core Data Model

(Key entities; columns abbreviated. All have `id uuid`, `created_at`, `updated_at`.)

| Entity | Key fields |
|---|---|
| `customer` | name, slug (subdomain), status, branding (json), settings (json), parent_customer_id (null in v1) |
| `customer_group` | customer_id, parent_id, name |
| `user` | email, password_hash, name, scope_type, customer_id, group_id?, role_id, totp_secret?, status, last_login |
| `role` | name, scope (platform/customer), customer_id?, permissions[] |
| `device_profile` | name, description, telemetry_schema (keys: name, label, unit, type, decimals), commands (name, label, params schema, confirm), offline_timeout_s, dead_timeout_s, location_mode (none/fixed/reported), retention_days, default_dashboard_template_id, transport (mqtt/http/aws-iot) |
| `device` | name, profile_id, customer_id?, group_id?, credentials_type (token/basic/x509), credentials, attributes (client/server/shared json), location (lat, lng, alt, source, updated_at), tags[], status (online/offline/dead/never), last_seen, firmware_version |
| `asset` | name, type, customer_id, parent_asset_id, location, attributes |
| `asset_device` | asset_id, device_id |
| `telemetry` (hypertable) | device_id, key, ts, value_num, value_str, value_bool, value_json — PK (device_id, key, ts) |
| `telemetry_latest` | device_id, key, ts, value (also cached in Redis) |
| `alarm_rule` | profile_id? / device_id?, customer_id?, name, type, condition (json), clear_condition, severity, schedule, cooldown_s, recipients (json), channels[], enabled |
| `alarm` | rule_id, device_id, customer_id, severity, status (active/acked/cleared), started_at, acked_by/at, cleared_at, details |
| `alarm_event` | alarm_id, type, user_id?, comment, ts |
| `command` | device_id, name, params, status (queued/sent/delivered/success/failed/timeout), requested_by, result, created_at, completed_at, expires_at |
| `dashboard_template` | name, profile_id?, kind (device/overview/asset), definition (json: layout, widgets, states), version |
| `dashboard_instance` | template_id, customer_id, override_definition (json, nullable) |
| `notification` | user_id, type, severity, title, body, link, read_at |
| `push_subscription` | user_id, endpoint, keys |
| `email_template` | key, customer_id?, subject, body_mjml |
| `api_key` | name, hash, scope, permissions[], expires_at, last_used |
| `firmware` | profile_id, version, file_key, sha256, size, notes |
| `ota_job` | firmware_id, target (device ids / profile), status, per-device progress |
| `geofence` | customer_id, name, shape (circle/polygon geojson) |
| `trip` | device_id, start_ts, end_ts, distance_m, start_loc, end_loc |
| `audit_log` | actor_type, actor_id, customer_id?, action, target_type, target_id, diff (json), ip, ts |
| `report_schedule` | customer_id?, dashboard_instance_id, cron, recipients, format |
| `export_job` | user_id, kind, params, status, file_key, expires_at |
| `system_setting` | key, value (encrypted when secret) |

### 4.1 Telemetry storage

- Hypertable chunked by 1 day; native compression after 7 days; per-profile retention via a scheduler job (`drop_chunks` cannot do per-device, so retention is a scheduled `DELETE` for non-default profiles plus a global `drop_chunks` at the max retention).
- Continuous aggregates: `telemetry_1m`, `telemetry_1h`, `telemetry_1d` (avg/min/max/last/count for numeric values), used automatically by chart queries based on time range.
- Inserts are batched in the ingest worker (flush every 250 ms or 1,000 rows) using `COPY`/multi-row insert with `ON CONFLICT DO NOTHING` for duplicate removal.

---

## 5. Device Connectivity (R3, R7, R15)

### 5.1 Perspice Protocol v1 — MQTT

Topics (`{id}` = device id; ACL restricts each device to its own subtree):

| Topic | Direction | Payload |
|---|---|---|
| `perspice/v1/{id}/telemetry` | device→platform | `{"ts":<ms>?,"values":{k:v}}` or array of those |
| `perspice/v1/{id}/attributes` | device→platform | `{k:v}` (client attributes, e.g. fw, serial) |
| `perspice/v1/{id}/status` | device→platform | `"online"` retained on connect; LWT `"offline"` |
| `perspice/v1/{id}/cmd` | platform→device | `{"cid":"<uuid>","name":"gen_start","params":{}}` |
| `perspice/v1/{id}/cmd/ack` | device→platform | `{"cid":"<uuid>","status":"success|failed","result":{}}` |
| `perspice/v1/{id}/config` | platform→device | shared attributes (retained) |
| `perspice/v1/{id}/ota` | platform→device | `{"version":"1.3.0","url":"https://...","sha256":"..."}` |
| `perspice/v1/{id}/ota/progress` | device→platform | `{"version":"1.3.0","state":"downloading|verifying|applied|failed","pct":42}` |

- QoS 1 for telemetry/commands. `ts` optional (server receive time used if absent). Values: number, string, boolean, or object.
- Payload validation with zod; invalid payloads are counted and logged against the device (visible in the device's "Debug" tab) but never crash the worker.
- MQTT authentication: username = device id, password = device token (or X.509 client cert with CN = device id). EMQX calls `POST /internal/emqx/auth` and `/internal/emqx/acl` on `api` (results cached in EMQX for 60 s).

### 5.2 HTTP transport

- `POST /api/v1/device/telemetry`, `POST /api/v1/device/attributes`, `GET /api/v1/device/commands?wait=30` (long-poll), `POST /api/v1/device/commands/{cid}/ack`, `GET /api/v1/device/config`.
- Auth header: `X-Device-Token: <token>`. Rate limited per device.

### 5.3 Device presence and offline detection (R15)

- **Online signal:** any accepted message updates `last_seen` (Redis sorted set `presence:last_seen` scored by timestamp; batched write-back to Postgres every 10 s). EMQX `client.connected` / `client.disconnected` webhooks set status immediately for persistent connections.
- **Timeouts:** `offline_timeout_s` and `dead_timeout_s` set on the device profile, overridable per device. Defaults: offline 300 s, dead 86,400 s.
- **Sweep:** scheduler runs every 30 s, `ZRANGEBYSCORE presence:last_seen -inf (now - min_timeout)` → evaluates per-device thresholds → transitions status (online→offline→dead).
- **Events:** each status transition emits `device.status_changed`, consumed by the rules worker (offline/dead alarm rules) and pushed to dashboards via WebSocket.
- A device that disconnects through MQTT but whose profile marks it as "sleepy" (has `offline_timeout_s` > 0 and `sleepy: true`) is **not** marked offline on disconnect; only the inactivity timeout applies.

### 5.4 Commands (RPC)

- API `POST /devices/{id}/commands` (permission `device.command`, command must be declared on the profile, params validated against its schema) → row in `command` → published to `cmd` topic (or held for HTTP long-poll).
- Status flow: `queued → sent → success|failed|timeout`. Timeout default 30 s; optional `persist_until_online` with `expires_at` for offline devices (sent when the device reconnects or next polls).
- Every command is audit-logged with user and parameters.

### 5.5 AWS IoT Core transport (R7)

- Per-profile `transport: aws-iot`. On device creation the platform calls AWS IoT (`CreateThing`, `CreateKeysAndCertificate`, `AttachPolicy`) and offers the cert bundle for download once.
- The ingest worker connects to the AWS IoT endpoint (with its own cert) and subscribes to the same `perspice/v1/+/...` topics; command publishing goes through AWS IoT Data Plane.
- Presence: AWS lifecycle events (`$aws/events/presence/connected|disconnected/+`) plus the same inactivity sweep.
- EMQX can be disabled entirely in an AWS-only deployment.

### 5.6 Firmware library — `PerspiceClient` (Arduino)

- Targets: ESP32 (Wi-Fi, W5500/LAN8720 Ethernet), Arduino AVR/SAMD with W5100/W5500 (Ethernet.h). PubSubClient for MQTT; ArduinoHttpClient fallback; ArduinoJson.
- API: `begin(config)`, `loop()`, `sendTelemetry(json)`, `sendTelemetryBatch()`, `setAttribute(k,v)`, `onCommand(name, handler)`, `onConfig(handler)`, `isConnected()`, `sleepCycle(seconds)` helper for deep-sleep devices.
- Reliability: reconnect with exponential back-off, NTP time sync (timestamps in ms), offline ring buffer (RAM; ESP32 also flash-backed via LittleFS) sent oldest-first on reconnect, MQTT LWT configured automatically.
- OTA (ESP32): HTTPS download, SHA-256 verify, `Update` API, progress reporting, rollback-safe boot partition.
- Examples: `BasicSensor`, `GeneratorController` (relays + commands), `EnergyMeterModbus` (Modbus RTU → telemetry), `GpsTracker` (TinyGPS++), `DeepSleepSensor`, `OtaUpdate`.

---

## 6. Alarms & Notifications (R8, R14)

### 6.1 Alarm rules

- Scope: profile-level (default for all devices of the profile), device-level override/addition, customer-level additions (if the customer admin has `alarm.rule.write`).
- Types: `threshold`, `range`, `duration` (condition true for ≥ N s), `rate_of_change`, `state_match`, `status` (offline/dead), `geofence` (enter/exit), `no_data_key`.
- Each rule: severity (critical/major/minor/warning), clear condition (with margin to prevent flapping), active schedule (days/hours, timezone), cooldown, recipients (roles/users/groups), channels.
- Evaluation: rules worker keeps per-(rule, device) state in Redis (e.g. duration timers). Alarm de-duplication: one active alarm per (rule, device).
- Lifecycle: `active → acknowledged → cleared` (clear can happen from active directly). Timeline in `alarm_event`.

### 6.2 Notifications

- Channel interface `NotificationChannel { send(recipient, message): Promise<Result> }`. v1 implementations: `email`, `inapp` (DB + WebSocket push), `webpush` (VAPID).
- Per-user preferences: channels enabled, minimum severity, quiet hours.
- Digest mode: if more than N notifications for a user within M minutes, batch remaining into a digest email.
- All sends go through BullMQ with retries and exponential back-off; failures are visible in an admin "Delivery log".

### 6.3 Email (R8)

- Drivers: SMTP (nodemailer) and AWS SES. Configured in admin settings with a "Send test email" button.
- Templates (MJML → HTML, Handlebars variables), editable per platform, overridable per customer, automatically branded with the customer's logo and colours: `user_invite`, `account_activated`, `password_reset`, `password_changed`, `alarm_raised`, `alarm_cleared`, `device_offline`, `device_online`, `report_delivery`, `digest`, `export_ready`.
- Password reset: single-use token (hashed in DB), 1-hour expiry, always returns the same response whether or not the email exists.
- Account creation: admin invites user → email with activation link (72-hour expiry) → user sets password.

---

## 7. Dashboards, Widgets and Export (R9, R10, R11)

### 7.1 Dashboard model

- `dashboard_template.definition` = `{ states: [{ id, name, layout: [...], widgets: [...] }], settings: { timewindow, refresh, filters } }`.
- Template kinds: `device` (bound to a profile; opened for a specific device), `overview` (fleet-wide for a customer), `asset` (bound to an asset type).
- **Assignment:** when a device of profile P is assigned to customer C, a `dashboard_instance` for P's default template is created for C if none exists. All of C's devices of profile P use it. Editing the template propagates to all instances without an override. "Detach / customise for this customer" creates an `override_definition`; "Re-sync with template" discards it.
- **Clone:** templates can be cloned and re-bound to another profile (keys are re-mapped through a key-mapping dialog when telemetry keys differ).
- Import/export of templates as JSON.

### 7.2 Data sources

`currentDevice`, `devicesOfProfile(P, filter)`, `asset(A).children`, `alarms(filter)`, `entityList` (devices/assets table), always constrained by the viewer's tenant scope.

### 7.3 Widget library (v1)

- **Charts:** time-series line/area (multi-series, multi-axis), bar, pie/donut, radial gauge, linear gauge, heatmap (time × key), sparkline.
- **Values:** value card (with trend), multi-value card, LED/status indicator, progress bar, battery, tank/level.
- **Tables:** latest values, history table, entity table (devices/assets with status, last seen, key columns), alarm table.
- **Maps:** Leaflet + OpenStreetMap tiles (tile URL configurable), markers coloured by status, clustering, popups, route playback, geofence overlay.
- **Control:** button, toggle, slider, set-point input; send declared commands or write shared attributes; optional confirm dialog; hidden or disabled without `device.command`.
- **Other:** markdown/HTML card (sanitised), image with value overlays (SCADA-style), event/alarm timeline, energy summary (daily/weekly/monthly consumption from cumulative counter).
- Widget plugin contract in `packages/widgets`: `{ type, name, icon, settingsSchema (zod → auto form), dataRequirements, Component }`.

### 7.4 Live data

- WebSocket (socket.io) subscriptions per widget data source; server fans out from Redis pub/sub channels `telemetry:{deviceId}` / `status:{customerId}` / `alarm:{customerId}` after scope check.
- History queries pick raw / 1 m / 1 h / 1 d sources automatically to return at most about 2,000 points per series.

### 7.5 Main overview (R10)

Built-in overview template for both platform and customer portals (overridable like any template):
- KPI tiles: total / online / offline / dead / never-connected devices, active alarms by severity, messages in last 24 h.
- Device table: status, name, profile, customer (platform view), last seen, location, key values per profile (configurable columns), filter/search/sort, click-through to device dashboard.
- Map of all located devices.
- Recent alarms list with ack action.

### 7.6 Export (R11)

- Any table/chart widget, device telemetry history, alarm lists, audit log: export to **XLSX** (exceljs), **CSV**, **PDF**.
- Whole-dashboard PDF reports: rendered server-side with headless Chromium (Playwright) against a print route, branded header/footer, date range.
- Exports above 50k rows run as background `export_job`; the user gets an in-app notification and email with a time-limited download link (files expire after 24 h).
- `report_schedule`: cron-based delivery of dashboard PDFs/XLSX by email.

---

## 8. White-labelling (R1)

- **Platform branding:** product name, logo (light/dark), favicon, primary/accent colours, login page background, email header/footer, support contact, custom CSS (advanced, sanitised).
- **Customer branding:** same fields, overriding the platform's when set; optional subdomain `{slug}.{platform-domain}`.
- Frontend resolves branding from `Host` at load time (`GET /api/public/branding`), applies colours as CSS variables (a full palette is generated from the primary colour, with an accessible-contrast check shown in the editor). Emails and PDF exports use the same resolution.
- Login on a customer subdomain only accepts that customer's users (platform users use the main domain).
- TLS for subdomains: wildcard cert via Caddy DNS-01 plugin (Cloudflare/Route53 supported) when DNS credentials are provided; otherwise Caddy on-demand TLS gated by an `/internal/caddy/ask` endpoint that only approves known slugs.

---

## 9. Security

- Passwords: Argon2id; policy (min length 10, breach-list check optional).
- Sessions: 15-minute JWT access token + rotating refresh token (httpOnly, Secure, SameSite=Lax cookie), refresh-token reuse detection revokes the session family.
- Optional TOTP 2FA per user; can be enforced per role (default enforced for Super Admin).
- Login rate limiting and progressive lockout; CSRF protection on cookie-authenticated mutations.
- API keys: hashed, permission-scoped, expiring; sent as `Authorization: Bearer pk_...`.
- Device credentials: random 32-byte tokens (hashed at rest; shown once on creation, regenerable), optional X.509.
- MQTT: TLS on 8883 (plain 1883 can be disabled; enabled by default for LAN-only deployments with a warning in the admin system page), per-device topic ACLs.
- Secrets in `system_setting` encrypted with AES-256-GCM using a master key from `.env`.
- Audit log for all mutations, logins, impersonation, commands, exports, backup/restore.
- Security headers via Caddy (HSTS, CSP, X-Frame-Options), HTML sanitisation for markdown widgets and custom CSS.

---

## 10. Storage, Backups and Deployment (R2, R5, R6, R13)

### 10.1 Storage abstraction

`StorageDriver { put, get, getSignedUrl, delete, list }` with `local` (filesystem under `/var/lib/perspice/storage`, served through signed API URLs) and `s3` (AWS SDK v3, works with any S3-compatible endpoint: AWS S3, MinIO, Wasabi, DigitalOcean Spaces, Backblaze B2). Used for logos, firmware, exports, backups.

### 10.2 Backups (R13)

- Contents: `pg_dump` (custom format), storage files (excluding exports and old backups), `.env`-derived config (without the master key unless the operator opts in), version manifest.
- Packaged as `perspice-backup-{version}-{timestamp}.tar.zst`, encrypted (AES-256-GCM, key from the operator's backup passphrase).
- Schedule configurable (default daily 02:00). **Retention: exactly one.** The new backup is written to a temporary name, verified (checksum and archive listing), then atomically replaces the previous one. A failed backup leaves the previous one intact and raises a platform alarm.
- Admin UI: Back up now, Download latest, Upload & restore. Restore checks version compatibility (same major version; migrations run forward if older minor), puts the platform into maintenance mode, restores DB and files, restarts services, runs health checks.
- CLI equivalents: `scripts/perspice backup`, `scripts/perspice restore <file>`.

### 10.3 Deployment topology

Docker Compose services: `caddy`, `web` (static, served by caddy), `api`, `ingest`, `rules`, `scheduler`, `postgres` (timescale/timescaledb-ha:pg16), `redis`, `emqx`, `minio` (optional profile), `mailpit` (test profile only).

`docker-compose.aws.yml` override can remove `redis`/`emqx`/`minio` and point to ElastiCache, S3, SES and IoT Core. **Database on AWS:** Amazon RDS does not support the TimescaleDB extension, so the AWS profile keeps the bundled `postgres` container on the EC2 instance by default (with EBS snapshots recommended), or points `DATABASE_URL` at Timescale Cloud. This is documented in the deployment guide.

Images are built in CI and published to GitHub Container Registry, tagged with the semantic version; `install.sh`/`update.sh` pull images by version tag (with a `--build` flag to build locally from source).

### 10.4 Scripts (R5, R6)

**`scripts/install.sh`**
1. Verify OS (Ubuntu 22.04+/Debian 12+), architecture (amd64/arm64), CPU/RAM/disk minimums, root/sudo.
2. Install prerequisites: curl, git, Docker Engine and Compose plugin (from Docker's official apt repo) if missing.
3. Interactive prompts or flags (`--domain`, `--admin-email`, `--smtp-*`, `--storage=local|s3`, `--mqtt=emqx|aws-iot`, `--non-interactive`).
4. Generate secrets (DB password, JWT keys, master key, EMQX API key, VAPID keys) into `/opt/perspice/.env` (mode 600).
5. Pull images, start stack, wait for health, run migrations, seed built-in roles, default device profiles and templates.
6. Create the Super Admin (activation email, or prints a one-time setup link if SMTP is not configured).
7. Open firewall ports (ufw if present): 80, 443, 8883 (and 1883 if enabled).
8. Print summary: URL, MQTT endpoints, next steps.
- Idempotent: re-running detects an existing install and refuses unless `--reinstall`.

**`scripts/update.sh [--version vX.Y.Z]`**
1. Check current and target version (default: latest release); show changelog excerpt.
2. Take a backup (same mechanism as 10.2, kept as the latest backup).
3. Pull new images; run migrations in a one-off container.
4. Rolling restart: ingest → rules → scheduler → api (MQTT shared subscription and multiple API containers keep service up); EMQX/Postgres/Redis only restarted when their pinned versions change.
5. Health check (`/health` on all roles, a synthetic MQTT publish round-trip).
6. On failure: restore previous image tags; if migrations were applied, restore the pre-update backup; report.

**`scripts/test.sh [--unit|--integration|--e2e|--load|--live <url>]`** (default: unit + integration + e2e)
- Unit: Vitest across packages.
- Integration: Testcontainers (Postgres/Timescale, Redis, EMQX, Mailpit) — ingest pipeline, offline sweep, alarm rules, email delivery, tenant isolation suite, backup/restore round-trip.
- E2E: Playwright against a composed test stack — login, invite user, create device, simulated device sends data, dashboard updates, alarm fires and is acknowledged, export downloads.
- Load: simulator runs N devices for M minutes and reports throughput/latency against the targets.
- Live: smoke test against a running install using a temporary test device (created and removed by the test).
- Firmware: library compiled for ESP32 and Arduino Uno+W5500 targets with `arduino-cli` in CI.

### 10.5 Versioning

- Git repository, semantic versioning, `VERSION` file, `CHANGELOG.md` (Keep a Changelog format), conventional commits.
- Database migrations (TypeORM or Drizzle; **Drizzle** chosen for type safety and plain SQL migrations) versioned in the repo; applied automatically by install/update.
- GitHub Actions: lint, typecheck, unit, integration, e2e, firmware compile, image build and publish on tag.

### 10.6 Observability

- `/health` (liveness) and `/ready` (dependencies) per role.
- Prometheus metrics endpoint (msg/s, ingest lag, queue depth, connected devices, WS clients, email failures); optional `monitoring` compose profile adds Prometheus + Grafana with a pre-built dashboard.
- Admin "System" page: service health, versions, message rate, queue depth, connected devices, disk usage, last backup status.
- Structured JSON logs (pino) with log-level control.

---

## 11. Additional Features (R14)

Included in the overall design (scheduled in later sub-projects):
- Device groups/tags and bulk operations (bulk assign, bulk command, CSV device import/export).
- Asset hierarchy (site → equipment) with asset dashboards.
- Device provisioning: claim codes so customers can self-add devices; CSV bulk provisioning.
- OTA firmware management (§5.6, `firmware`/`ota_job`).
- Fleet: trip detection, distance per day, route playback, geofences (§7.3, `trip`/`geofence`).
- Energy: consumption from cumulative counters, per-period aggregation, cost tariff (simple flat/time-of-use) for energy summary widgets.
- Generator/RMS: run-hours counters derived from a running-state key, fuel consumption estimate, maintenance reminders (hour- or date-based) as alarm-rule type `maintenance_due`.
- Calculated telemetry: per-profile derived keys defined by safe expressions (e.g. `power = v * i * pf`), evaluated in the ingest pipeline (sandboxed expression parser, no `eval`).
- Device debug view: last 100 raw messages, rejected payloads, connection events.
- Public REST API with OpenAPI docs (Swagger UI at `/api/docs`) for integrations.
- Webhook integration (outbound HTTP on alarm/telemetry events) as an extra notification channel.
- Internationalisation framework (i18next) with English shipped; timezone per user and per customer.
- Light/dark theme.

---

## 12. Error Handling Principles

- Ingest never drops valid data because of a downstream failure: telemetry write failures retry with back-off; if Postgres is unavailable, batches go to a Redis stream buffer (bounded, with a metric and platform alarm when filling) and are replayed later.
- MQTT QoS 1 plus duplicate removal on `(device_id, key, ts)` gives effectively-once storage.
- Invalid device payloads are rejected per message (logged to device debug view), never per connection.
- All background jobs are idempotent and retried with exponential back-off; permanent failures land in a dead-letter list visible in admin.
- API errors use a consistent problem-JSON shape `{ code, message, details }`; 404 (not 403) for cross-tenant object access.
- The frontend shows connection state (live/reconnecting) and degrades to polling when WebSocket fails.

---

## 13. Sub-project Decomposition & Build Order

Each sub-project gets its own implementation plan (and spec addendum if detail is needed) and ends in a tagged, installable release.

| # | Sub-project | Scope | Release |
|---|---|---|---|
| **1** | **Core platform** | Monorepo, Docker stack, install/update/test scripts, auth (login, invite, reset, 2FA), tenancy & RBAC with isolation tests, platform and customer branding (+ subdomains), device profiles, devices & credentials, MQTT (EMQX auth/ACL/webhooks) and HTTP ingest, Perspice protocol v1, telemetry storage + aggregates, offline/dead detection, commands, email system (SMTP/SES + templates), in-app notifications, audit log, basic device list/detail UI with latest values and simple history chart, PerspiceClient library with BasicSensor + GeneratorController examples, device simulator | v0.1.0 |
| 2 | Dashboards & widgets | Template/instance model, builder UI, widget plugin SDK, v1 widget library, main overview dashboards, live WS subscriptions, export XLSX/CSV/PDF, dashboard PDF reports, template clone/import/export | v0.2.0 |
| 3 | Alarms & notifications | Alarm rule engine (all types), alarm UI, notification preferences, web push, digests, scheduled reports, webhook channel | v0.3.0 |
| 4 | Operations | Backup/restore (UI + CLI), storage driver S3, AWS IoT Core transport, AWS compose profile, monitoring profile, load-test validation of success criterion 8 | v0.4.0 |
| 5 | Domain features | Location (fixed/reported), maps, fleet trips & geofences, OTA, assets, calculated telemetry, energy/generator features, claim-code provisioning, bulk ops | v0.5.0 → v1.0.0 |

Sub-project 1 is the subject of the first implementation plan.

---

## 14. Out of Scope (v1)

- SMS, WhatsApp, Telegram, and voice notification channels (channel interface allows later addition).
- Fully custom customer domains (e.g. `monitor.acme.com`) — subdomains only.
- Kubernetes/Helm deployment.
- Windows server installs.
- Visual rule-chain editor (rules are form-configured).
- Mobile native apps (the web UI is responsive and installable as a PWA).
- Multi-region/HA clustering of Postgres (single primary; backups as recovery).
