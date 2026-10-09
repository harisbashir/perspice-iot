import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { count, gte, sql } from 'drizzle-orm';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { alarm, deliveryLog, device } from '../db/schema';
import { Dispatcher } from '../delivery/dispatcher';
import { EmailService } from '../email/email.service';
import { ExportsService } from '../exports/exports.service';
import { BackupService } from '../backups/backup.service';
import { ReportsService } from '../reports/reports.service';
import { MetricsService } from './metrics.service';

/**
 * Fleet-wide gauges read from the database and queues. Collected in the scheduler role only, so
 * the numbers aren't repeated by every process.
 */
@Injectable()
export class SystemCollectors implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    private readonly metrics: MetricsService,
    private readonly email: EmailService,
    private readonly dispatcher: Dispatcher,
    private readonly exportJobs: ExportsService,
    private readonly reports: ReportsService,
    private readonly backups: BackupService,
  ) {}

  /** Queues by name, for metrics and the System page. */
  queues(): Record<string, Queue> {
    return { email: this.email.queue, notify: this.dispatcher.queue, exports: this.exportJobs.queue, reports: this.reports.queue, maintenance: this.backups.queue };
  }

  onModuleInit(): void {
    const role = this.config.PERSPICE_ROLE;
    if (role !== 'scheduler' && role !== 'all') return;

    this.metrics.gauge('perspice_devices', 'Devices by status', ['status'], async (g) => {
      g.reset();
      const rows = await this.db.select({ status: device.status, n: count() }).from(device).groupBy(device.status);
      for (const r of rows) g.set({ status: r.status }, r.n);
    });
    this.metrics.gauge('perspice_alarms_open', 'Open alarms by severity', ['severity'], async (g) => {
      g.reset();
      const rows = await this.db.select({ severity: alarm.severity, n: count() }).from(alarm).where(sql`${alarm.status} <> 'cleared'`).groupBy(alarm.severity);
      for (const r of rows) g.set({ severity: r.severity }, r.n);
    });
    this.metrics.gauge('perspice_deliveries_last_hour', 'Notification and webhook deliveries in the last hour', ['channel', 'status'], async (g) => {
      g.reset();
      const rows = await this.db
        .select({ channel: deliveryLog.channel, status: deliveryLog.status, n: count() })
        .from(deliveryLog)
        .where(gte(deliveryLog.createdAt, new Date(Date.now() - 3_600_000)))
        .groupBy(deliveryLog.channel, deliveryLog.status);
      for (const r of rows) g.set({ channel: r.channel, status: r.status }, r.n);
    });
    this.metrics.gauge('perspice_queue_jobs', 'Background jobs by queue and state', ['queue', 'state'], async (g) => {
      g.reset();
      for (const [name, q] of Object.entries(this.queues())) {
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        for (const [state, n] of Object.entries(counts)) g.set({ queue: name, state }, n);
      }
    });
  }
}
