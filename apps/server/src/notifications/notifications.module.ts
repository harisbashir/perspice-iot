import { type DynamicModule, Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { StatusNotifierConsumer } from './status-notifier.consumer';

@Global()
@Module({})
export class NotificationsModule {
  static forRoot(opts: { rules: boolean }): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [NotificationsService, ...(opts.rules ? [StatusNotifierConsumer] : [])],
      exports: [NotificationsService],
    };
  }
}
