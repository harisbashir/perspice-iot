import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { RedisModule } from './common/redis.module';
import type { Config, Role } from './config/config';
import { ConfigModule } from './config/config.module';

export const runsRole = (current: Role, wanted: Exclude<Role, 'all'>) => current === 'all' || current === wanted;

@Module({})
export class AppModule {
  /** Composes the module graph for the configured process role. */
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-device-token"]'],
          },
        }),
        CommonModule,
        RedisModule,
      ],
    };
  }
}
