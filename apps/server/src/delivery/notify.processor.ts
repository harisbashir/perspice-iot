import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { Dispatcher, NOTIFY_QUEUE } from './dispatcher';

/** Consumes the notify queue (api and rules roles, like email). */
@Injectable()
export class NotifyProcessor implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker<{ deliveryId: string }>;
  private connection?: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly dispatcher: Dispatcher,
  ) {}

  onModuleInit(): void {
    this.connection = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<{ deliveryId: string }>(NOTIFY_QUEUE, (job) => this.dispatcher.run(job.data.deliveryId), {
      connection: this.connection,
      concurrency: 10,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
