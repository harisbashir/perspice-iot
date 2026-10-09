import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { RedisModule } from './common/redis.module';
import type { Config, Role } from './config/config';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { RbacModule } from './rbac/rbac.module';
import { DevicesModule } from './devices/devices.module';
import { EventsModule } from './events/event-bus';
import { EmqxModule } from './emqx/emqx.module';
import { IngestModule } from './ingest/ingest.module';
import { PresenceModule } from './presence/presence.module';
import { CommandsModule } from './commands/commands.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DocsModule } from './openapi';
import { SchedulerModule } from './scheduler/scheduler.module';
import { EmailModule } from './email/email.module';
import { SettingsModule } from './settings/settings.module';
import { StorageModule } from './storage/storage.module';

export const runsRole = (current: Role, wanted: Exclude<Role, 'all'>) => current === 'all' || current === wanted;

@Module({})
export class AppModule {
  /** Composes the module graph for the configured process role. */
  static forRoot(config: Config): DynamicModule {
    const role = config.PERSPICE_ROLE;
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
        DbModule,
        SettingsModule,
        StorageModule,
        BrandingModule,
        EmailModule.forRoot({ processor: runsRole(role, 'api') || runsRole(role, 'rules') }),
        AuditModule,
        AuthModule,
        RbacModule,
        EventsModule,
        DevicesModule,
        EmqxModule.forRoot({ api: runsRole(role, 'api') }),
        SchedulerModule,
        PresenceModule.forRoot({ scheduler: runsRole(role, 'scheduler') }),
        CommandsModule.forRoot({ api: runsRole(role, 'api'), scheduler: runsRole(role, 'scheduler') }),
        TelemetryModule,
        DashboardsModule,
        NotificationsModule.forRoot({ rules: runsRole(role, 'rules') }),
        ...(runsRole(role, 'api') ? [RealtimeModule, DocsModule] : []),
        IngestModule.forRoot({ mqtt: runsRole(role, 'ingest'), http: runsRole(role, 'api') }),
      ],
    };
  }
}
