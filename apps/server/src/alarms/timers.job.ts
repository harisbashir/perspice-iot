import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JobRegistry } from '../scheduler/job-registry';
import { AlarmEngine } from './engine';

/** Every 10 s (scheduler role): fires duration and no-data timers that are due. */
@Injectable()
export class AlarmTimersJob implements OnApplicationBootstrap {
  constructor(
    private readonly engine: AlarmEngine,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_ALARM_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('alarm-timers', 10_000, () => this.engine.tick().then(() => undefined));
  }
}
