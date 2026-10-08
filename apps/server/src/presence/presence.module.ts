import { type DynamicModule, Global, Module } from '@nestjs/common';
import { OfflineSweepJob } from './offline-sweep.job';
import { PresenceService } from './presence.service';

@Global()
@Module({})
export class PresenceModule {
  static forRoot(opts: { scheduler: boolean }): DynamicModule {
    return {
      module: PresenceModule,
      providers: [
        PresenceService,
        OfflineSweepJob,
        { provide: 'SCHEDULE_PRESENCE_JOBS', useValue: opts.scheduler },
      ],
      exports: [PresenceService, OfflineSweepJob],
    };
  }
}
