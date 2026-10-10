import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobRegistry } from '../scheduler/job-registry';
import { GeofencesController } from './geofences.controller';
import { GeofencesService } from './geofences.service';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { TripsService } from './trips.service';

const FLUSH_INTERVAL_MS = 10_000;
const TRIP_SWEEP_INTERVAL_MS = 60_000;

/** Scheduler: writes pending reported locations to the database, and closes quiet trips. */
@Injectable()
export class LocationFlushJob implements OnApplicationBootstrap {
  constructor(
    private readonly location: LocationService,
    private readonly trips: TripsService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_LOCATION_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.schedule) return;
    this.jobs.every('location-flush', FLUSH_INTERVAL_MS, () => this.location.flush().then(() => undefined));
    this.jobs.every('trip-sweep', TRIP_SWEEP_INTERVAL_MS, () => this.trips.sweep().then(() => undefined));
  }
}

@Global()
@Module({})
export class LocationModule {
  static forRoot(opts: { api: boolean; scheduler: boolean; rules: boolean }): DynamicModule {
    return {
      module: LocationModule,
      controllers: opts.api ? [LocationController, GeofencesController] : [],
      providers: [
        LocationService,
        TripsService,
        GeofencesService,
        LocationFlushJob,
        { provide: 'SCHEDULE_LOCATION_JOBS', useValue: opts.scheduler },
        { provide: 'RUN_TRIPS', useValue: opts.rules },
      ],
      exports: [LocationService, TripsService, GeofencesService],
    };
  }
}
