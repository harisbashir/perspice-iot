import { type DynamicModule, Global, Module } from '@nestjs/common';
import { EnergyController } from './energy.controller';
import { EnergyService } from './energy.service';
import { TariffService } from './tariff.service';

/** Energy and tariffs (spec §11). */
@Global()
@Module({})
export class EnergyModule {
  static forRoot(opts: { api: boolean }): DynamicModule {
    return {
      module: EnergyModule,
      controllers: opts.api ? [EnergyController] : [],
      providers: [TariffService, EnergyService],
      exports: [TariffService, EnergyService],
    };
  }
}
