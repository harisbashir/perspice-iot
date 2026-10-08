import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { StreamConsumer } from '../events/stream-consumer';
import { CommandsPublisher } from './commands.publisher';
import { CommandsService } from './commands.service';

/** Sends held commands when a device comes online and publishes shared-attribute changes. */
@Injectable()
export class CommandsListener implements OnModuleInit, OnApplicationShutdown {
  private consumer?: StreamConsumer;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly commands: CommandsService,
    private readonly publisher: CommandsPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer = new StreamConsumer(this.redis, {
      group: 'api-commands',
      handle: async (event) => {
        if (event.type === 'device.status_changed' && event.to === 'online') await this.commands.sendQueued(event.deviceId);
        if (event.type === 'device.config_changed') await this.publisher.publishConfig(event.deviceId, event.shared);
      },
    });
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
