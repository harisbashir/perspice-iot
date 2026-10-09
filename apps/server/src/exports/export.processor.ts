import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { EXPORTS_QUEUE, ExportsService } from './exports.service';

/** Consumes the exports queue. Runs in the `scheduler` and `all` roles. */
@Injectable()
export class ExportProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExportProcessor.name);
  private worker?: Worker<{ jobId: string }>;
  private connection?: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly exports: ExportsService,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<{ jobId: string }>(EXPORTS_QUEUE, (job) => this.exports.process(job.data.jobId), {
      connection: this.connection,
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) => this.logger.warn(`Export ${job?.data.jobId} failed: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
