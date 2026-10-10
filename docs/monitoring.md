# Monitoring

## System page

**System** (super admins and platform admins) shows, refreshed every 10 seconds:

- every running process (`api`, `ingest`, `rules`, `scheduler`, `renderer`), its version and when it started, and roles that are expected but missing;
- messages per minute, connected devices, browser sessions;
- background queues (waiting, active, failed);
- database size, storage used and free;
- the latest backup and whether one is running;
- maintenance mode.

Each process reports a heartbeat to Redis every 10 seconds; a process that stops reporting for 30 seconds drops off the list.

## Prometheus and Grafana

An optional monitoring profile adds Prometheus and Grafana. Add to `/opt/perspice/.env`:

```bash
COMPOSE_PROFILES=monitoring
GRAFANA_ADMIN_PASSWORD=<a strong password>
```

then start them:

```bash
cd /opt/perspice && sudo docker compose -p perspice --env-file .env up -d
```

Grafana listens on **127.0.0.1:3001** only; reach it through an SSH tunnel (`ssh -L 3001:localhost:3001 server`) and sign in as `admin`. The **Perspice** dashboard is provisioned: message rate and results, telemetry rows, devices by status, open alarms, queues, websocket sessions, deliveries, memory and CPU per process. Prometheus keeps 30 days.

Each process serves `/metrics` (Prometheus text format) on its own port inside the Docker network; it isn't exposed through Caddy. Set `METRICS_ENABLED=false` to turn the endpoints off.

### Metrics

| Metric | |
| --- | --- |
| `perspice_ingest_messages_total{result}` | device messages received, by result (`ok`, `rejected`, …) |
| `perspice_ingest_rows_total` | telemetry rows written |
| `perspice_ingest_buffer_length` | rows waiting in the Redis failover buffer (non-zero: the database is unreachable or slow) |
| `perspice_devices{status}` | devices by status |
| `perspice_alarms_open{severity}` | open alarms |
| `perspice_queue_jobs{queue,state}` | background jobs |
| `perspice_websocket_clients` | browser sessions on this instance |
| `perspice_deliveries_last_hour` | notification and webhook deliveries |
| `perspice_process_*`, `perspice_nodejs_*` | Node.js process metrics |

Worth alerting on: `perspice_ingest_buffer_length > 0` for more than a few minutes; `perspice_queue_jobs{state="failed"}` rising; a target down (`up == 0`); disk space on the server.

## Logs

`perspice logs <service>` follows a service's logs (JSON, one line per event). `LOG_LEVEL` (`debug`, `info`, `warn`, `error`) sets the detail. Docker keeps 5 × 20 MB per service.
