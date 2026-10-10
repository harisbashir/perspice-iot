-- TimescaleDB setup for telemetry (spec §4.1). Hand-written; drizzle-kit does not manage these objects.
CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint
SELECT create_hypertable('telemetry', 'ts', chunk_time_interval => interval '1 day');
--> statement-breakpoint
ALTER TABLE telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, key',
  timescaledb.compress_orderby = 'ts DESC'
);
--> statement-breakpoint
SELECT add_compression_policy('telemetry', interval '7 days');
--> statement-breakpoint
CREATE MATERIALIZED VIEW telemetry_1m WITH (timescaledb.continuous) AS
SELECT device_id, key, time_bucket(interval '1 minute', ts) AS bucket,
       avg(value_num) AS avg, min(value_num) AS min, max(value_num) AS max,
       last(value_num, ts) AS last, count(value_num) AS count
FROM telemetry
WHERE value_num IS NOT NULL
GROUP BY device_id, key, bucket
WITH NO DATA;
--> statement-breakpoint
CREATE MATERIALIZED VIEW telemetry_1h WITH (timescaledb.continuous) AS
SELECT device_id, key, time_bucket(interval '1 hour', ts) AS bucket,
       avg(value_num) AS avg, min(value_num) AS min, max(value_num) AS max,
       last(value_num, ts) AS last, count(value_num) AS count
FROM telemetry
WHERE value_num IS NOT NULL
GROUP BY device_id, key, bucket
WITH NO DATA;
--> statement-breakpoint
CREATE MATERIALIZED VIEW telemetry_1d WITH (timescaledb.continuous) AS
SELECT device_id, key, time_bucket(interval '1 day', ts) AS bucket,
       avg(value_num) AS avg, min(value_num) AS min, max(value_num) AS max,
       last(value_num, ts) AS last, count(value_num) AS count
FROM telemetry
WHERE value_num IS NOT NULL
GROUP BY device_id, key, bucket
WITH NO DATA;
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('telemetry_1m',
  start_offset => interval '1 hour', end_offset => interval '2 minutes', schedule_interval => interval '1 minute');
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('telemetry_1h',
  start_offset => interval '3 hours', end_offset => interval '1 hour', schedule_interval => interval '30 minutes');
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('telemetry_1d',
  start_offset => interval '3 days', end_offset => interval '1 day', schedule_interval => interval '6 hours');
