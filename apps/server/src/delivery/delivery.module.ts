import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AlarmNotifier } from './alarm-notifier';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { Dispatcher } from './dispatcher';
import { NotifyProcessor } from './notify.processor';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { RecipientResolver } from './recipients';
import { CHANNELS, type NotificationChannel } from './types';

@Global()
@Module({})
export class DeliveryModule {
  static forRoot(opts: { api: boolean; worker: boolean }): DynamicModule {
    return {
      module: DeliveryModule,
      controllers: opts.api ? [PreferencesController] : [],
      providers: [
        PreferencesService,
        RecipientResolver,
        InAppChannel,
        EmailChannel,
        { provide: CHANNELS, inject: [InAppChannel, EmailChannel], useFactory: (...channels: NotificationChannel[]) => channels },
        Dispatcher,
        AlarmNotifier,
        ...(opts.worker ? [NotifyProcessor] : []),
      ],
      exports: [Dispatcher, RecipientResolver, PreferencesService],
    };
  }
}
