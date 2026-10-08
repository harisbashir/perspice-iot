import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, type Config } from '../config/config';
import { HealthRegistry } from './health.registry';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [CONFIG, HealthRegistry],
      useFactory: (config: Config, health: HealthRegistry) => {
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
        const logger = new Logger('Redis');
        let lastLogged = 0;
        redis.on('error', (err) => {
          // Reconnects are automatic; log at most every 10 s so an outage does not flood the log.
          if (Date.now() - lastLogged > 10_000) {
            lastLogged = Date.now();
            logger.warn(`Redis error: ${err.message}`);
          }
        });
        health.register('redis', async () => {
          await redis.ping();
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
