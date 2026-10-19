# Operations

Everything lives in `/opt/perspice` (`docker-compose.yml`, `.env`, `backups/`, `update.log`).
The `perspice` command wraps Docker Compose for that directory.

| Command | Purpose |
|---|---|
| `perspice status` | services and health |
| `perspice logs [service]` | follow logs (`api`, `ingest`, `rules`, `scheduler`, `renderer`, `emqx`, `caddy`, …) |
| `perspice restart [service]` | restart all or one service |
| `perspice version` | installed version |
| `perspice cli <command>` | server CLI: `create-admin`, `health --mqtt-roundtrip`, `configure-smtp`, `seed`, … |
| `perspice backup [file]` | full encrypted backup (database and files) to `backups/` or `file` ([backups.md](backups.md)) |
| `perspice restore <file>` | restore a full backup (maintenance mode meanwhile) |
| `perspice db-snapshot [file]` | dump the database to `backups/` |
| `perspice db-restore <file>` | restore a dump (app services stop meanwhile) |
| `perspice update [--version vX.Y.Z]` | upgrade (see below) |

## Updating

```bash
sudo perspice update                    # to the latest release
sudo perspice update --version v1.0.0   # to a given one
```

The update:

1. refuses downgrades (unless `--allow-downgrade`);
2. adds `BACKUP_PASSPHRASE` to `.env` if it's missing (keep a copy elsewhere), takes a full backup
   to `backups/pre-update-<old version>-<time>.pbk` when the running version is v0.4.0 or later, and
   snapshots the database to `backups/pre-update-<old version>-<time>.dump` for the automatic
   rollback (only the newest of each is kept);
3. installs the release's deployment files (`docker-compose.yml`, EMQX and cert-sync
   configuration) and its own `update.sh` and `perspice` CLI, then pulls the new images and runs
   the migrations;
4. restarts the infrastructure whose configuration changed (Redis, PostgreSQL), recreates EMQX and
   cert-sync (their configuration comes from files Compose can't watch; devices reconnect within
   seconds), then `ingest`, `rules`, `scheduler`, `renderer`, `api` and `caddy`, waiting for each
   to be healthy, and starts any service the release adds;
5. checks health with a real MQTT publish → ingest round trip (up to six tries, ten seconds
   apart, while ingest settles).

If any step fails it switches back to the previous version (and compose file) and, if migrations
had run, restores the snapshot; containers of services only the new release has are removed.
Details go to `/opt/perspice/update.log`.

### Installs built from source, and offline servers

Installs made with `install.sh --build` (and servers without access to the image registry) update
from a source tree or release tarball instead of pulling images:

```bash
sudo perspice update --source /path/to/perspice-iot-1.0.0      # or …/perspice-iot-1.0.0.tar.gz
```

The target version is the tree's `VERSION`. Source installs made **before 1.0** have an updater
without `--source`; run the new release's own updater once:

```bash
git clone --branch v1.0.0 https://github.com/harisbashir/perspice-iot.git /tmp/perspice-1.0.0
sudo /tmp/perspice-1.0.0/scripts/update.sh --source /tmp/perspice-1.0.0
```

### Upgrading to 1.0 from 0.x

Every 0.x release upgrades directly to 1.0 (tested from v0.1.0 and v0.8.0 with real data,
including an automatic rollback). Worth knowing:

- Built-in roles are re-synced from code at start-up and gain the 0.6–0.8 permissions
  (`device.claim`, `tariff.manage`, `device.service`, `asset.*`).
- Custom roles keep exactly their permissions. From 1.0, dashboard widgets and live updates also
  require the permissions of the data they show (`telemetry.read`, `alarm.read`): add them to
  custom roles that should see values on dashboards.
- Ingest now keeps one MQTT session across restarts (`INGEST_ID`); sessions left by earlier
  releases are removed automatically on its first start.

## Backups and restores

See [backups.md](backups.md): scheduled and on-demand encrypted backups from **System**, and
restores from the page or `perspice restore`. Restores (of backups and of `db-snapshot` dumps) go
into a fresh database (with TimescaleDB's pre/post-restore steps) that replaces the live one only
after `pg_restore` succeeds, so a failed restore leaves the current data in place.

## Processes

One image runs in several roles (`PERSPICE_ROLE`):

| Role | Does |
|---|---|
| `api` | HTTP API, WebSocket updates, EMQX auth/ACL hooks, command publishing |
| `ingest` | consumes device MQTT traffic (shared subscription), writes telemetry |
| `rules` | alarm rule evaluation, device status notifications, webhooks for status changes |
| `scheduler` | backups and restores, offline/dead sweep, command timeouts, last-seen write-back, large exports, export cleanup, alarm timers (duration, no data), notification digests, scheduled reports (one instance runs each job) |
| `renderer` | dashboard PDF reports with headless Chromium (own image, `perspice-renderer`) |

`all` (the default outside Compose) runs every role except `renderer`, which needs the
Chromium image.

## History retention

Each device profile's **History retention (days)** applies to raw readings: every 6 hours the
`scheduler` deletes older ones (keeping at least 4 days, which the daily summary's refresh needs).
Minute, hourly and daily summaries are kept for good, so long-range charts, energy figures and
exports of summarised data still work; charts of a short period further back than the retention
show minute averages.

## Exports and reports

- Exports up to 50,000 rows download straight away; larger ones run on the `scheduler` and the
  user is notified (in-app and by email) when the file is ready. PDF exports are limited to
  10,000 rows.
- Dashboard PDF reports always run in the background on the `renderer`. It opens the web app's
  print page through Caddy's internal listener (`http://caddy:8080`, not published), authorised
  by a single-use render token that expires after 60 s.
- Export and report files live in the `storage_data` volume under `exports/` and are deleted,
  with their jobs, 24 hours after they finish. Download links are signed, valid for 5 minutes and
  only handed to the user who requested the export.
- A report stuck in "Queued" usually means the `renderer` is not running:
  `perspice status` / `perspice logs renderer`.

## Notifications and webhooks

- Every email, push, in-app notification and webhook call is a row in **Settings → Delivery
  log**. Failed sends are retried 5 times with exponential back-off (starting at 30 s); the ones
  that still fail are marked as given up (dead letters) and can be retried from the log.
- Email goes through the SMTP or SES settings (**Settings → Email**). Without them, email
  deliveries fail and show "Email is not configured".
- **Web push** needs a VAPID key pair. The installer generates one; otherwise use **System → Set up
  push notifications**, or `perspice cli vapid-keys` with the output and a contact
  (`VAPID_SUBJECT=mailto:ops@example.com`) in `.env` and `perspice restart`. Without keys, push is
  hidden in the app.
- **Webhooks** may only reach public `https` addresses. To deliver to receivers on your own
  network, a super admin allows plain HTTP and/or private addresses under **Settings →
  Webhooks**.

## Health

The **System** page shows processes, queues and storage, and (for super admins) can **Run check**
(the same round trip as `perspice cli health --mqtt-roundtrip`), **Set up push notifications**
(creates VAPID keys and stores them encrypted, for installs without `VAPID_*` in `.env`), and shows a
notice with the update command when a newer release is published (checked against GitHub
releases of `UPDATE_REPO`, default `harisbashir/perspice-iot`, every 6 hours; nothing is shown
offline).

- `GET /health`: process is up (`{status, role, version}`)
- `GET /ready`: database and Redis reachable (503 lists failing dependencies)
- `perspice cli health --mqtt-roundtrip`: end-to-end ingest check
- **System** page and Prometheus `/metrics`: see [monitoring.md](monitoring.md)

## Tests

`scripts/test.sh` runs unit, integration (Testcontainers) and end-to-end (Playwright in Docker)
suites; `--live https://iot.example.com` smoke-tests a running install with
`PERSPICE_LIVE_ADMIN_TOKEN` set to an API key; `--load` runs the 10,000-device load test
([load-test.md](load-test.md)).

## Running on AWS

S3 storage and AWS IoT Core: see [aws.md](aws.md).
