import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { PDF_RENDERER, type PdfRenderer } from './pdf-renderer';
import { REPORTS_QUEUE, ReportsService } from './reports.service';

/** Consumes the reports queue. Runs only in the `renderer` role (the image with Chromium). */
@Injectable()
export class ReportProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReportProcessor.name);
  private worker?: Worker<{ jobId: string }>;
  private connection?: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    private readonly reports: ReportsService,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<{ jobId: string }>(REPORTS_QUEUE, (job) => this.reports.process(job.data.jobId, this.renderer), {
      connection: this.connection,
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) => this.logger.warn(`Report ${job?.data.jobId} failed: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
