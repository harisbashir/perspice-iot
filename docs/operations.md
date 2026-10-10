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
sudo perspice update --version v0.2.0
```

The update:

1. refuses downgrades (unless `--allow-downgrade`);
2. adds `BACKUP_PASSPHRASE` to `.env` if it's missing (keep a copy elsewhere), takes a full backup
   to `backups/pre-update-<old version>-<time>.pbk` when the running version is v0.4.0 or later, and
   snapshots the database to `backups/pre-update-<old version>-<time>.dump` for the automatic
   rollback (only the newest of each is kept);
3. installs the release's deployment files (`docker-compose.yml`, EMQX and cert-sync config), so
   services added by a release (v0.2.0: `renderer`) appear, then pulls the new images and runs
   migrations;
4. restarts `ingest`, `rules`, `scheduler`, `renderer`, `api` (waiting for each to be healthy), then `caddy`;
5. checks health with a real MQTT publish → ingest round trip.

If any step fails it switches back to the previous version (and compose file) and, if migrations
had run, restores the snapshot. Details go to `/opt/perspice/update.log`.

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
- **Web push** needs a VAPID key pair. Generate one with `perspice cli vapid-keys`, put the
  output and a contact (`VAPID_SUBJECT=mailto:ops@example.com`) in `.env`, then
  `perspice restart`. Without keys, push is hidden in the app.
- **Webhooks** may only reach public `https` addresses. To deliver to receivers on your own
  network, a super admin allows plain HTTP and/or private addresses under **Settings →
  Webhooks**.

## Health

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
