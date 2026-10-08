import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { DEVICE_EVENTS_STREAM, type DomainEvent } from './events';

const STREAM_MAXLEN = 100_000;

/** Publishes domain events to a Redis Stream; consumers read it with consumer groups. */
@Injectable()
export class EventBus {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.redis.xadd(DEVICE_EVENTS_STREAM, 'MAXLEN', '~', STREAM_MAXLEN, '*', 'event', JSON.stringify(event));
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
