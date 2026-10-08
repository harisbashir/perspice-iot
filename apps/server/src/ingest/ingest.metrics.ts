import { Injectable } from '@nestjs/common';

export type IngestMetric = 'ingest_messages_total' | 'ingest_rows_total' | 'ingest_buffer_length';

/** In-process counters; exposed by the observability endpoint. */
@Injectable()
export class IngestMetrics {
  private readonly values = new Map<string, number>();

  inc(name: IngestMetric, by = 1, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  set(name: IngestMetric, value: number, labels: Record<string, string> = {}): void {
    this.values.set(this.key(name, labels), value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  private key(name: string, labels: Record<string, string>): string {
    const l = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return l ? `${name}{${l}}` : name;
  }
}
