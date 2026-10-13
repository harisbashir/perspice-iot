import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { IngestMetrics } from './ingest.metrics';
import type { WriteRow } from './normalize';
import { type FailoverBuffer, type TelemetrySink, TelemetryWriter } from './telemetry-writer';

export const INGEST_BUFFER_STREAM = 'ingest:buffer';
const BUFFER_MAXLEN = 1_000_000;
const REPLAY_LOCK = 'lock:ingest-replay';

/**
 * Rows as seven column arrays for `unnest()`: one short statement with seven parameters per
 * batch. (A multi-row VALUES list through the query builder has seven parameters per row; at
 * 1000 messages/s building and sending it was most of ingest's CPU.)
 */
function columns(rows: WriteRow[]) {
  return {
    deviceIds: rows.map((r) => r.deviceId),
    keys: rows.map((r) => r.key),
    ts: rows.map((r) => new Date(r.ts).toISOString()),
    nums: rows.map((r) => r.valueNum ?? null),
    strs: rows.map((r) => r.valueStr ?? null),
    bools: rows.map((r) => r.valueBool ?? null),
    jsons: rows.map((r) => (r.valueJson === undefined || r.valueJson === null ? null : JSON.stringify(r.valueJson))),
  };
}

/**
 * The rows as a relation, keeping only devices that still exist: a device deleted while its
 * messages were in flight must not fail the other devices' rows in the same batch.
 */
const unnestRows = (c: ReturnType<typeof columns>) =>
  // sql.param binds each array as one parameter (a bare array would be expanded into a list).
  sql`SELECT u.* FROM unnest(${sql.param(c.deviceIds)}::uuid[], ${sql.param(c.keys)}::text[], ${sql.param(c.ts)}::timestamptz[], ${sql.param(c.nums)}::float8[], ${sql.param(c.strs)}::text[], ${sql.param(c.bools)}::boolean[], ${sql.param(c.jsons)}::jsonb[])
    AS u(device_id, key, ts, value_num, value_str, value_bool, value_json)
    WHERE EXISTS (SELECT 1 FROM device d WHERE d.id = u.device_id)`;

/**
 * Whether a failed write is worth retrying: the database is down, unreachable or overloaded. Any
 * other error (bad data, a violated constraint) would fail the same way every time.
 */
const isTransient = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = String(e.cause?.code ?? e.code ?? '');
  const message = String(e.cause?.message ?? e.message ?? '');
  return (
    /^(08|53|57|58)/.test(code) || // connection, resources, operator intervention, system
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'].includes(code) ||
    /Connection terminated|timeout|connect/i.test(message)
  );
};

/** Newest row per (device, key): an upsert may not touch the same row twice in one statement. */
function newestPerKey(rows: WriteRow[]): WriteRow[] {
  const best = new Map<string, WriteRow>();
  for (const r of rows) {
    const k = `${r.deviceId}\u0000${r.key}`;
    const cur = best.get(k);
    if (!cur || r.ts > cur.ts) best.set(k, r);
  }
  return [...best.values()];
}

@Injectable()
export class TelemetryStore implements TelemetrySink, FailoverBuffer, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelemetryStore.name);
  readonly writer: TelemetryWriter;
  private replayTimer?: NodeJS.Timeout;
  private replayDelayMs = 1000;
  private readonly instanceId = randomUUID();

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: IngestMetrics,
  ) {
    this.writer = new TelemetryWriter(this, this, { maxRows: 1000, flushMs: 250 }, (err) =>
      this.logger.warn(`Telemetry write failed, buffering: ${err.message}`),
    );
  }

  onModuleInit(): void {
    this.scheduleReplay();
  }

  async onApplicationShutdown(): Promise<void> {
    clearTimeout(this.replayTimer);
    await this.writer.close();
  }

  /**
   * Inserts history (duplicates dropped) and advances `telemetry_latest` for newer values. Redis
   * holds the exact latest values; the stored copy (fallback, key list, sorting) is rewritten only
   * once it is a minute behind, so a device reporting every few seconds doesn't rewrite its rows on
   * every batch (at 1000 messages/s that churn was most of PostgreSQL's work). New keys are
   * stored at once.
   */
  async write(rows: WriteRow[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO telemetry (device_id, key, ts, value_num, value_str, value_bool, value_json)
        ${unnestRows(columns(rows))}
        ON CONFLICT DO NOTHING`);
      await tx.execute(sql`
        INSERT INTO telemetry_latest AS l (device_id, key, ts, value_num, value_str, value_bool, value_json)
        ${unnestRows(columns(newestPerKey(rows)))}
        ON CONFLICT (device_id, key) DO UPDATE SET
          ts = excluded.ts, value_num = excluded.value_num, value_str = excluded.value_str,
          value_bool = excluded.value_bool, value_json = excluded.value_json
        WHERE l.ts < excluded.ts - interval '1 minute'`);
    });
    this.metrics.inc('ingest_rows_total', rows.length);
  }

  async save(rows: WriteRow[]): Promise<void> {
    await this.redis.xadd(INGEST_BUFFER_STREAM, 'MAXLEN', '~', BUFFER_MAXLEN, '*', 'rows', JSON.stringify(rows));
  }

  /** Replays buffered batches once the database is healthy again (backoff 1 s → 30 s). */
  private scheduleReplay(): void {
    this.replayTimer = setTimeout(() => {
      void this.replay().finally(() => this.scheduleReplay());
    }, this.replayDelayMs);
    this.replayTimer.unref();
  }

  private async replay(): Promise<void> {
    try {
      const length = await this.redis.xlen(INGEST_BUFFER_STREAM);
      this.metrics.set('ingest_buffer_length', length);
      if (!length) {
        this.replayDelayMs = 1000;
        return;
      }
      const locked = await this.redis.set(REPLAY_LOCK, this.instanceId, 'PX', 30_000, 'NX');
      if (!locked) return;
      try {
        for (;;) {
          const entries = await this.redis.xrange(INGEST_BUFFER_STREAM, '-', '+', 'COUNT', 50);
          if (!entries.length) break;
          for (const [id, fields] of entries) {
            try {
              await this.write(JSON.parse(fields[1]!) as WriteRow[]);
            } catch (err) {
              // One batch the database will never accept must not hold up everything behind it.
              if (isTransient(err)) throw err;
              this.metrics.inc('ingest_batches_dropped_total', 1);
              this.logger.error(`Dropped a buffered batch the database refuses: ${(err as Error).message.slice(0, 300)}`);
            }
            await this.redis.xdel(INGEST_BUFFER_STREAM, id);
          }
        }
        this.replayDelayMs = 1000;
        this.logger.log('Replayed buffered telemetry');
      } finally {
        await this.redis.del(REPLAY_LOCK);
      }
    } catch (err) {
      this.replayDelayMs = Math.min(this.replayDelayMs * 2, 30_000);
      this.logger.warn(`Replay failed, retrying in ${this.replayDelayMs} ms: ${(err as Error).message}`);
    }
  }
}
