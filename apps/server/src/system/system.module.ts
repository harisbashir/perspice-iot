import { type DynamicModule, Global, Module } from '@nestjs/common';
import { SystemCollectors } from './collectors';
import { Heartbeat } from './heartbeat';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({})
export class SystemModule {
  static forRoot(opts: { api: boolean }): DynamicModule {
    return {
      module: SystemModule,
      controllers: opts.api ? [MetricsController] : [],
      providers: [MetricsService, Heartbeat, SystemCollectors],
      exports: [MetricsService, Heartbeat, SystemCollectors],
    };
  }
}
