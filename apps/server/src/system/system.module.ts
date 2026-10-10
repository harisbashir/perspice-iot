import { type DynamicModule, Global, Module } from '@nestjs/common';
import { SystemCollectors } from './collectors';
import { Heartbeat } from './heartbeat';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Global()
@Module({})
export class SystemModule {
  static forRoot(opts: { api: boolean }): DynamicModule {
    return {
      module: SystemModule,
      controllers: opts.api ? [MetricsController, SystemController] : [],
      providers: [MetricsService, Heartbeat, SystemCollectors, SystemService],
      exports: [MetricsService, Heartbeat, SystemCollectors],
    };
  }
}
