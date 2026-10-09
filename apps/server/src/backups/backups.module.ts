import { type DynamicModule, Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { BackupScheduleJob } from './backup.schedule';
import { BackupService } from './backup.service';
import { BackupsController } from './backups.controller';
import { Maintenance, MaintenanceMiddleware } from './maintenance';
import { MaintenanceProcessor } from './maintenance.processor';
import { RestoreService } from './restore.service';

@Global()
@Module({})
export class BackupsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MaintenanceMiddleware).forRoutes('*path');
  }

  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: BackupsModule,
      controllers: opts.api ? [BackupsController] : [],
      providers: [
        BackupService,
        RestoreService,
        Maintenance,
        MaintenanceMiddleware,
        BackupScheduleJob,
        { provide: 'SCHEDULE_BACKUPS', useValue: opts.scheduler },
        ...(opts.scheduler ? [MaintenanceProcessor] : []),
      ],
      exports: [BackupService, RestoreService, Maintenance, BackupScheduleJob, ...(opts.scheduler ? [MaintenanceProcessor] : [])],
    };
  }
}
