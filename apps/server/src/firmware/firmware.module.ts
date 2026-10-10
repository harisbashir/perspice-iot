import { type DynamicModule, Global, Module } from '@nestjs/common';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';
import { OtaController } from './ota.controller';
import { OtaService } from './ota.service';

@Global()
@Module({})
export class FirmwareModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: FirmwareModule,
      controllers: opts.api ? [FirmwareController, OtaController] : [],
      providers: [FirmwareService, OtaService, { provide: 'SCHEDULE_OTA', useValue: opts.scheduler }],
      exports: [FirmwareService, OtaService],
    };
  }
}
