import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AlarmStore } from './alarm-store';
import { AlarmEngine } from './engine';
import { AlarmRulesController } from './rules.controller';
import { AlarmRulesService } from './rules.service';
import { AlarmTimersJob } from './timers.job';

@Global()
@Module({})
export class AlarmsModule {
  static forRoot(opts: { api: boolean; rules: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: AlarmsModule,
      controllers: opts.api ? [AlarmRulesController] : [],
      providers: [
        AlarmRulesService,
        AlarmStore,
        AlarmEngine,
        AlarmTimersJob,
        { provide: 'RUN_ALARM_ENGINE', useValue: opts.rules },
        { provide: 'SCHEDULE_ALARM_JOBS', useValue: opts.scheduler },
      ],
      exports: [AlarmRulesService, AlarmStore, AlarmEngine],
    };
  }
}
