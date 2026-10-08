import { Global, Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local.driver';
import { STORAGE } from './storage.driver';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE,
      inject: [CONFIG],
      useFactory: (config: Config) => new LocalStorageDriver(config.STORAGE_LOCAL_PATH, config.JWT_SECRET),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
