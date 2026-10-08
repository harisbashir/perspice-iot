import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { StreamConsumer } from '../events/stream-consumer';
import { EmqxClient } from './emqx.client';

/** Kicks a device's MQTT session when it is deleted or its credentials change (Review Focus 4). */
@Injectable()
export class EmqxKickListener implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EmqxKickListener.name);
  private consumer?: StreamConsumer;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly emqx: EmqxClient,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer = new StreamConsumer(this.redis, {
      group: 'api-emqx',
      handle: async (event) => {
        if (event.type !== 'device.deleted' && event.type !== 'device.credentials_changed') return;
        await this.emqx.kick(event.deviceId);
        this.logger.log(`Kicked ${event.deviceId} (${event.type})`);
      },
    });
    await this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
