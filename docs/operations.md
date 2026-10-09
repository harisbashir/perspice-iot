# Operations

Everything lives in `/opt/perspice` (`docker-compose.yml`, `.env`, `backups/`, `update.log`).
The `perspice` command wraps Docker Compose for that directory.

| Command | Purpose |
|---|---|
| `perspice status` | services and health |
| `perspice logs [service]` | follow logs (`api`, `ingest`, `rules`, `scheduler`, `emqx`, `caddy`, …) |
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
3. pulls the new images and runs migrations;
4. restarts `ingest`, `rules`, `scheduler`, `api` (waiting for each to be healthy), then `caddy`;
5. checks health with a real MQTT publish → ingest round trip.

If any step fails it switches back to the previous version and, if migrations had run,
restores the snapshot. Details go to `/opt/perspice/update.log`.

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
| `scheduler` | offline/dead sweep, command timeouts, last-seen write-back (one instance runs each job) |

## Health

- `GET /health`: process is up (`{status, role, version}`)
- `GET /ready`: database and Redis reachable (503 lists failing dependencies)
- `perspice cli health --mqtt-roundtrip`: end-to-end ingest check

## Tests

`scripts/test.sh` runs unit, integration (Testcontainers) and end-to-end (Playwright in Docker)
suites; `--live https://iot.example.com` smoke-tests a running install with
`PERSPICE_LIVE_ADMIN_TOKEN` set to an API key; `--load` runs the simulator.
