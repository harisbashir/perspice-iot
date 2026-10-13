# Load test

Success criterion 8: **on a 4 vCPU / 8 GB server, Perspice handles 10,000 devices sending one message every 10 seconds (1,000 messages a second) with no loss and live updates within 2 seconds (p95).**

## Running it

```bash
scripts/test.sh --load          # or: deploy/test/loadtest.sh
```

It needs Docker, Node.js 22, python3 and a machine with at least 6 cores (4 for the stack, the rest for the simulator), and takes about 25 minutes. The script:

1. builds the images and starts the stack with `deploy/test/loadtest.override.yml`, which runs every service on the same **four cores** (`cpuset: 0-3`), as on a 4 vCPU server, with memory capped per service at 7.75 GB in all (PostgreSQL 2.5 GB, EMQX 1.5 GB, ingest and API 1 GB each, rules, Redis and scheduler 512 MB, Caddy 256 MB). The report renderer isn't started; it isn't on the device path.

   Fixed CPU shares per service (say 1 CPU for PostgreSQL, 0.75 for EMQX, …) were tried first and dropped: they throttle one service's bursts while others sit idle, which a real 4-core server doesn't do, and the outcome depended on how the four CPUs were split.
2. creates a super admin and an API key, and has the simulator (`apps/simulator`) create 10,000 devices on the *Generic Sensor* profile;
3. connects them over MQTT, 500 a second, then has each send one message every 10 seconds for 15 minutes, spread evenly so the load is steady;
4. watches 1% of the devices through the realtime API (the websocket the dashboards use), measuring the time from publish to push;
5. counts the messages stored in TimescaleDB inside the sending window.

It passes when:

- the sustained rate is at least **990 messages/s** (99% of what was offered),
- **every message sent was stored** (loss = sent − stored = 0),
- **p95 latency** from publish to websocket push is under **2 s**,
- no publish failed.

The simulator runs on the remaining cores (`taskset`), and connects to EMQX's container address so Docker's port proxy doesn't spend CPU outside the stack's cores. Container CPU and memory are sampled every 10 s; the summary gives each service's peak and the whole stack's peak and average while sending (400% = all four cores).

Options: `LOAD_COUNT`, `LOAD_DURATION` (seconds) and `LOAD_INTERVAL` change the load; `LOAD_OUT=<dir>` keeps the summary (`summary.json`), the simulator's per-minute log and container usage (`stats.tsv`, `stats-peak.txt`); `SKIP_BUILD=1` reuses images; `KEEP_STACK=1` leaves the stack up; `LOAD_OVERRIDE=<file>` adds a compose override (e.g. to profile a service).

To load an existing installation instead (no limits applied, no loss count), set `PERSPICE_LOAD_URL`, `PERSPICE_LOAD_MQTT` and `PERSPICE_LOAD_API_KEY` (see `scripts/test.sh --help`).

## Results

Run on 2026-10-09 with `scripts/test.sh --load` (commit after `feat(aws): AWS deployment profile`, v0.4.0 candidate).

**Host:** Ubuntu 24.04.5 LTS under WSL2, 8 vCPU, 15 GB RAM, Docker 29.8.2. Stack on cores 0–3, simulator on cores 4–7.

**Result: pass.**

| | result | criterion |
| --- | --- | --- |
| devices | 10,000 (connected in 40 s) | 10,000 |
| sustained rate | 999.8 messages/s (every minute 999.3–1000.1) | ≥ 990 |
| sent / stored | 899,859 / 899,859 — **0 lost** | 0 lost |
| publish errors | 0 | 0 |
| latency, publish → websocket | p50 51 ms, **p95 692 ms**, p99 2.8 s, max 3.2 s (9,000 samples) | p95 < 2 s |

Per minute, p95 latency was 2.8 s in the first minute (right after 10,000 connections), then 33–695 ms.

CPU while sending (100% = one core):

| service | average | peak |
| --- | --- | --- |
| emqx | 113% | 159% |
| ingest | 72% | 115% |
| postgres | 59% | 124% |
| rules | 51% | 84% |
| redis | 31% | 46% |
| api | 10% | 61% |
| scheduler | 10% | 49% |
| **whole stack** | **332% of 400%** | 417% |

Memory peaked at 1.1 GB (EMQX), 460 MB (PostgreSQL), about 300 MB per Node.js process: well inside 8 GB.

**Headroom is modest:** the stack uses about 3.3 of the 4 cores at this rate. The test defines no alarm rules; a deployment with many rules per device will spend more in `rules`. For fleets near this size, plan on a larger server or move PostgreSQL to its own machine.

### v0.5.0, with mobile devices

Rerun with `LOAD_MOBILE_SHARE=0.1`: 1,000 of the 10,000 devices drive and park around a city,
reporting positions on a profile with reported locations and trip detection (location fixes,
trip state machine and geofence evaluation in the path). Same host and limits.

| | result |
| --- | --- |
| sustained rate | 1000.0 messages/s (every minute 999.9–1000) |
| sent / stored | 899,975 / 899,975 — **0 lost** |
| latency, publish → websocket | p50 13 ms, **p95 63 ms**, p99 701 ms, max 891 ms |
| whole stack CPU | 310% average, 376% peak of 400% |

### v0.7.0, with calculated telemetry

Rerun with the default `LOAD_CALCULATED=1`: the profile gets two formulas (`dew_point`,
`temperature_f`) and a counter delta on a simulated energy meter, so every message is evaluated
and stores three more values (about 4,000 rows/s instead of 3,000). Same host and limits.

| | result |
| --- | --- |
| sustained rate | 999.9 messages/s (every minute 999.8–1000.1) |
| sent / stored | 899,964 / 899,964 — **0 lost** |
| latency, publish → websocket | p50 28 ms, **p95 191 ms**, p99 1,699 ms, max 2,121 ms |
| whole stack CPU | 346% average, 402% peak of 400% |

The criterion still holds, but with almost no headroom: the extra rows cost PostgreSQL and ingest
CPU (peaks 134% and 97%), and the tail latency rises. Each calculated key adds a stored value per
message, so size servers for the rows written, not only the messages received.

### v1.0.0

The release run, with the same settings as v0.7.0 (calculated keys on).

| | result |
| --- | --- |
| sustained rate | 1000 messages/s (every minute 999.8–1000.2) |
| sent / stored | 899,975 / 899,975 — **0 lost** |
| latency, publish → websocket | p50 18 ms, **p95 95 ms**, p99 3,152 ms, max 3,468 ms |
| whole stack CPU | 338% average, 422% peak of 400% |

## Bottlenecks found and fixed

The first runs failed. What the test found, in order:

1. **Lost messages at the broker.** When ingest fell behind for a moment, EMQX dropped messages once the ingest session's queue reached its default 1,000 (861 lost in 15 minutes), and once closed the connection for mailbox overflow. Ingest and the API now connect on an internal listener (port 1884, not published) whose zone queues up to 200,000 messages.
2. **Ingest CPU in query building.** About 40% of ingest's CPU went into building and sending multi-row `INSERT … VALUES` statements (7 parameters per row). Batches are now written with `unnest()` over seven array parameters.
3. **Publishes refused under load.** Per-topic ACL checks went to the API over HTTP; during the connection storm some timed out, and EMQX treats a failed check as a denial (28% of messages refused in one run; the simulator, on MQTT 3.1.1, couldn't see it). Devices now get their topic rules with the authentication result, so publishes need no HTTP call, and the simulator uses MQTT 5 so a refused publish counts as an error.
4. **Websocket fan-out for no one.** The API parsed and encoded every telemetry message although only watched devices need it. It now skips devices nobody is watching.
5. **Rewriting every device row.** `last_seen` was written back for every device every 10 s, and `telemetry_latest` on every batch: thousands of row updates a second. Redis keeps the exact values; the database copies are now refreshed once they are 5 minutes (`last_seen`) or 1 minute (latest values) behind.
6. **Redis persistence.** With the append-only file on, RDB snapshots still ran every minute and AOF rewrites every few minutes, each forking Redis. Now AOF only, rewriting after 256 MB of growth.
7. **One socket write per Redis command.** Profiles of ingest, rules and API all showed command-by-command writes as the top cost. Auto-pipelining, `EVALSHA` for the latest-value script, one acknowledgement per batch of stream entries, and telemetry events on their own stream (only the alarms engine reads them) cut Redis load from 18,500 to about 12,000 commands/s.
8. **The test itself.** Fixed CPU shares per service throttled bursts a real server absorbs; the test now pins the stack to four shared cores. EMQX's default topic-alias limit (65,535) made each MQTT 5 client allocate about 1 MB, so the simulator ran out of memory; the broker now allows 16 aliases per connection.
