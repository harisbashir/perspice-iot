import { type DynamicModule, Module } from '@nestjs/common';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({})
export class SchedulesModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: SchedulesModule,
      controllers: opts.api ? [SchedulesController] : [],
      providers: [SchedulesService, { provide: 'SCHEDULE_REPORT_JOBS', useValue: opts.scheduler }],
      exports: [SchedulesService],
    };
  }
}
