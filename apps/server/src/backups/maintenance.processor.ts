import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { BackupService, MAINTENANCE_QUEUE } from './backup.service';
import { RestoreService } from './restore.service';

/** Runs backups (and restores) one at a time. Scheduler role. */
@Injectable()
export class MaintenanceProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  private worker?: Worker;
  private connection?: Redis;
  /** Job name → handler. */
  readonly handlers = new Map<string, (data: Record<string, unknown>) => Promise<unknown>>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly backups: BackupService,
    private readonly restores: RestoreService,
  ) {
    this.handlers.set('backup', () => this.backups.run());
    this.handlers.set('restore', (data) => this.restores.run(String(data.key)));
  }

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Unknown maintenance job ${job.name}`);
        return handler(job.data as Record<string, unknown>);
      },
      // Long-running jobs: a generous lock, renewed while they run.
      { connection: this.connection, concurrency: 1, lockDuration: 120_000 },
    );
    this.worker.on('failed', (job, err) => this.logger.warn(`Maintenance job ${job?.name} failed: ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
