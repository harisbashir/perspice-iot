import { Global, Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local.driver';
import { S3StorageDriver } from './s3.driver';
import { STORAGE } from './storage.driver';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        config.STORAGE_DRIVER === 's3'
          ? new S3StorageDriver(
              {
                bucket: config.S3_BUCKET!,
                region: config.S3_REGION,
                endpoint: config.S3_ENDPOINT,
                accessKeyId: config.S3_ACCESS_KEY_ID,
                secretAccessKey: config.S3_SECRET_ACCESS_KEY,
                forcePathStyle: config.S3_FORCE_PATH_STYLE,
              },
              config.JWT_SECRET,
            )
          : new LocalStorageDriver(config.STORAGE_LOCAL_PATH, config.JWT_SECRET),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
