import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobRegistry } from '../scheduler/job-registry';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

const FLUSH_INTERVAL_MS = 10_000;

/** Scheduler: writes pending reported locations to the database. */
@Injectable()
export class LocationFlushJob implements OnApplicationBootstrap {
  constructor(
    private readonly location: LocationService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_LOCATION_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('location-flush', FLUSH_INTERVAL_MS, () => this.location.flush().then(() => undefined));
  }
}

@Global()
@Module({})
export class LocationModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: LocationModule,
      controllers: opts.api ? [LocationController] : [],
      providers: [LocationService, LocationFlushJob, { provide: 'SCHEDULE_LOCATION_JOBS', useValue: opts.scheduler }],
      exports: [LocationService],
    };
  }
}
