import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AssetTypesService } from './asset-types.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/** Asset hierarchy (spec §4, §11). */
@Global()
@Module({})
export class AssetsModule {
  static forRoot(opts: { api: boolean }): DynamicModule {
    return {
      module: AssetsModule,
      controllers: opts.api ? [AssetsController] : [],
      providers: [AssetTypesService, AssetsService],
      exports: [AssetTypesService, AssetsService],
    };
  }
}
