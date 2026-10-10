import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { CONFIG, type Config } from '../config/config';

/**
 * This process's Prometheus registry (served at `/metrics` on the internal port). Gauges whose
 * values come from the database are collected in one role only (see SystemCollectors).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();

  constructor(@Inject(CONFIG) config: Config) {
    this.registry.setDefaultLabels({ role: config.PERSPICE_ROLE });
    collectDefaultMetrics({ register: this.registry, prefix: 'perspice_' });
  }

  counter(name: string, help: string, labelNames: string[] = []): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter({ name, help, labelNames, registers: [this.registry] });
      this.counters.set(name, c);
    }
    return c;
  }

  /** `collect` (optional) runs on every scrape and sets the gauge's current values. */
  gauge(name: string, help: string, labelNames: string[] = [], collect?: (g: Gauge) => Promise<void> | void): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge({
        name,
        help,
        labelNames,
        registers: [this.registry],
        ...(collect ? { async collect(this: Gauge) { await collect(this); } } : {}),
      });
      this.gauges.set(name, g);
    }
    return g;
  }

  async text(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
