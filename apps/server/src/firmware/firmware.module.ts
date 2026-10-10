import { type DynamicModule, Global, Module } from '@nestjs/common';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';

@Global()
@Module({})
export class FirmwareModule {
  static forRoot(opts: { api: boolean }): DynamicModule {
    return {
      module: FirmwareModule,
      controllers: opts.api ? [FirmwareController] : [],
      providers: [FirmwareService],
      exports: [FirmwareService],
    };
  }
}
