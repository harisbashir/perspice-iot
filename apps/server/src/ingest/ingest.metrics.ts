import { Injectable } from '@nestjs/common';
import type { Counter, Gauge } from 'prom-client';
import { MetricsService } from '../system/metrics.service';

export type IngestMetric = 'ingest_messages_total' | 'ingest_rows_total' | 'ingest_buffer_length';

/** Ingest counters, exported as `perspice_<name>` on /metrics. */
@Injectable()
export class IngestMetrics {
  private readonly counters: Record<'ingest_messages_total' | 'ingest_rows_total', Counter>;
  private readonly bufferLength: Gauge;

  constructor(metrics: MetricsService) {
    this.counters = {
      ingest_messages_total: metrics.counter('perspice_ingest_messages_total', 'Device messages received, by result', ['result']),
      ingest_rows_total: metrics.counter('perspice_ingest_rows_total', 'Telemetry rows written'),
    };
    this.bufferLength = metrics.gauge('perspice_ingest_buffer_length', 'Telemetry rows waiting in the Redis failover buffer');
  }

  inc(name: IngestMetric, by = 1, labels: Record<string, string> = {}): void {
    if (name === 'ingest_buffer_length') this.bufferLength.inc(by);
    else this.counters[name].inc(labels, by);
  }

  set(name: IngestMetric, value: number): void {
    if (name === 'ingest_buffer_length') this.bufferLength.set(value);
  }
}
