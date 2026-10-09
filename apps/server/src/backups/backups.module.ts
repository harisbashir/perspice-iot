import { type DynamicModule, Global, Module } from '@nestjs/common';
import { BackupScheduleJob } from './backup.schedule';
import { BackupService } from './backup.service';
import { BackupsController } from './backups.controller';
import { MaintenanceProcessor } from './maintenance.processor';

@Global()
@Module({})
export class BackupsModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: BackupsModule,
      controllers: opts.api ? [BackupsController] : [],
      providers: [
        BackupService,
        BackupScheduleJob,
        { provide: 'SCHEDULE_BACKUPS', useValue: opts.scheduler },
        ...(opts.scheduler ? [MaintenanceProcessor] : []),
      ],
      exports: [BackupService, BackupScheduleJob, ...(opts.scheduler ? [MaintenanceProcessor] : [])],
    };
  }
}
