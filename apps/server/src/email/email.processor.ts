import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { EMAIL_QUEUE, type EmailJob, EmailService } from './email.service';

/** Consumes the email queue. Runs in the `api`, `rules` and `all` roles. */
@Injectable()
export class EmailProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EmailProcessor.name);
  private worker?: Worker<EmailJob>;
  private connection?: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<EmailJob>(EMAIL_QUEUE, (job) => this.email.deliver(job.data), {
      connection: this.connection,
      concurrency: 5,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Email ${job?.data.templateKey} to ${job?.data.to} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
