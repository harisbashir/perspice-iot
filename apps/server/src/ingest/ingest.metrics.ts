import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import type { Counter, Gauge } from 'prom-client';
import { MetricsService } from '../system/metrics.service';

export type IngestMetric = 'ingest_messages_total' | 'ingest_rows_total' | 'ingest_buffer_length';

/** Per-minute message counts shared by all ingest processes (for the System page). */
export const messageRateKey = (minute: number) => `rate:messages:${minute}`;

/** Ingest counters, exported as `perspice_<name>` on /metrics. */
@Injectable()
export class IngestMetrics implements OnModuleDestroy {
  private pending = 0;
  private readonly flushTimer: NodeJS.Timeout;
  private readonly counters: Record<'ingest_messages_total' | 'ingest_rows_total', Counter>;
  private readonly bufferLength: Gauge;

  constructor(
    metrics: MetricsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.flushTimer = setInterval(() => void this.flush(), 5000);
    this.counters = {
      ingest_messages_total: metrics.counter('perspice_ingest_messages_total', 'Device messages received, by result', ['result']),
      ingest_rows_total: metrics.counter('perspice_ingest_rows_total', 'Telemetry rows written'),
    };
    this.bufferLength = metrics.gauge('perspice_ingest_buffer_length', 'Telemetry rows waiting in the Redis failover buffer');
  }

  inc(name: IngestMetric, by = 1, labels: Record<string, string> = {}): void {
    if (name === 'ingest_buffer_length') this.bufferLength.inc(by);
    else this.counters[name].inc(labels, by);
    if (name === 'ingest_messages_total' && labels.result === 'accepted') this.pending += by;
  }

  /** Adds the accepted messages since the last flush to the shared per-minute counter. */
  async flush(now = Date.now()): Promise<void> {
    if (!this.pending) return;
    const n = this.pending;
    this.pending = 0;
    const key = messageRateKey(Math.floor(now / 60_000));
    await this.redis.multi().incrby(key, n).expire(key, 600).exec().catch(() => undefined);
  }

  onModuleDestroy(): void {
    clearInterval(this.flushTimer);
    void this.flush();
  }

  set(name: IngestMetric, value: number): void {
    if (name === 'ingest_buffer_length') this.bufferLength.set(value);
  }
}
