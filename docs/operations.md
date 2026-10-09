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
| `perspice db-snapshot [file]` | dump the database to `backups/` |
| `perspice db-restore <file>` | restore a dump (app services stop meanwhile) |
| `perspice update [--version vX.Y.Z]` | upgrade (see below) |

## Updating

```bash
sudo perspice update --version v0.2.0
```

The update:

1. refuses downgrades (unless `--allow-downgrade`);
2. snapshots the database to `backups/pre-update-<old version>-<time>.dump` (only the newest is kept);
3. installs the release's deployment files (`docker-compose.yml`, EMQX and cert-sync config), so
   services added by a release (v0.2.0: `renderer`) appear, then pulls the new images and runs
   migrations;
4. restarts `ingest`, `rules`, `scheduler`, `renderer`, `api` (waiting for each to be healthy), then `caddy`;
5. checks health with a real MQTT publish → ingest round trip.

If any step fails it switches back to the previous version (and compose file) and, if migrations
had run, restores the snapshot. Details go to `/opt/perspice/update.log`.

## Restores

Restores go into a fresh database (with TimescaleDB's pre/post-restore steps) that replaces the
live one only after `pg_restore` succeeds, so a failed restore leaves the current data in place.

## Processes

One image runs in several roles (`PERSPICE_ROLE`):

| Role | Does |
|---|---|
| `api` | HTTP API, WebSocket updates, EMQX auth/ACL hooks, command publishing |
| `ingest` | consumes device MQTT traffic (shared subscription), writes telemetry |
| `rules` | device status notifications (email, in-app) |
| `scheduler` | offline/dead sweep, command timeouts, last-seen write-back, large exports, export cleanup (one instance runs each job) |
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

## Health

- `GET /health`: process is up (`{status, role, version}`)
- `GET /ready`: database and Redis reachable (503 lists failing dependencies)
- `perspice cli health --mqtt-roundtrip`: end-to-end ingest check

## Tests

`scripts/test.sh` runs unit, integration (Testcontainers) and end-to-end (Playwright in Docker)
suites; `--live https://iot.example.com` smoke-tests a running install with
`PERSPICE_LIVE_ADMIN_TOKEN` set to an API key; `--load` runs the simulator.
