-- Real-time aggregation: queries on the continuous aggregates also include rows newer than the
-- last refresh (TimescaleDB ≥ 2.13 defaults to materialized-only).
ALTER MATERIALIZED VIEW telemetry_1m SET (timescaledb.materialized_only = false);
--> statement-breakpoint
ALTER MATERIALIZED VIEW telemetry_1h SET (timescaledb.materialized_only = false);
--> statement-breakpoint
ALTER MATERIALIZED VIEW telemetry_1d SET (timescaledb.materialized_only = false);
