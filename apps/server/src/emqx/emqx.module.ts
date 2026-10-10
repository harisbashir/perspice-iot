import { type DynamicModule, Global, Module } from '@nestjs/common';
import { EmqxKickListener } from './emqx-kick.listener';
import { EmqxClient } from './emqx.client';
import { EmqxController } from './emqx.controller';

@Global()
@Module({})
export class EmqxModule {
  /** The auth hooks and kick listener belong to the `api` role; the REST client is shared. */
  static forRoot(opts: { api: boolean; emqx: boolean }): DynamicModule {
    return {
      module: EmqxModule,
      controllers: opts.api ? [EmqxController] : [],
      // Kicking sessions needs EMQX; on AWS IoT Core deactivating the certificate does the same.
      providers: [EmqxClient, ...(opts.api && opts.emqx ? [EmqxKickListener] : [])],
      exports: [EmqxClient],
    };
  }
}
