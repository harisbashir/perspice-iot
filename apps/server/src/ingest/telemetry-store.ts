import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { telemetry, telemetryLatest } from '../db/schema';
import { IngestMetrics } from './ingest.metrics';
import type { WriteRow } from './normalize';
import { type FailoverBuffer, type TelemetrySink, TelemetryWriter } from './telemetry-writer';

export const INGEST_BUFFER_STREAM = 'ingest:buffer';
const BUFFER_MAXLEN = 1_000_000;
const REPLAY_LOCK = 'lock:ingest-replay';

const toDbRow = (r: WriteRow) => ({
  deviceId: r.deviceId,
  key: r.key,
  ts: new Date(r.ts),
  valueNum: r.valueNum,
  valueStr: r.valueStr,
  valueBool: r.valueBool,
  valueJson: r.valueJson ?? null,
});

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

  /** Inserts history (duplicates dropped) and advances `telemetry_latest` only for newer values. */
  async write(rows: WriteRow[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(telemetry).values(rows.map(toDbRow)).onConflictDoNothing();
      await tx
        .insert(telemetryLatest)
        .values(newestPerKey(rows).map(toDbRow))
        .onConflictDoUpdate({
          target: [telemetryLatest.deviceId, telemetryLatest.key],
          set: {
            ts: sql`excluded.ts`,
            valueNum: sql`excluded.value_num`,
            valueStr: sql`excluded.value_str`,
            valueBool: sql`excluded.value_bool`,
            valueJson: sql`excluded.value_json`,
          },
          setWhere: sql`${telemetryLatest.ts} < excluded.ts`,
        });
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
            await this.write(JSON.parse(fields[1]!) as WriteRow[]);
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
