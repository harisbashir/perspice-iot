import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AlarmNotifier } from './alarm-notifier';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { PushChannel } from './channels/push.channel';
import { Dispatcher } from './dispatcher';
import { NotifyProcessor } from './notify.processor';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { RecipientResolver } from './recipients';
import { CHANNELS, type NotificationChannel } from './types';

@Global()
@Module({})
export class DeliveryModule {
  static forRoot(opts: { api: boolean; worker: boolean }): DynamicModule {
    return {
      module: DeliveryModule,
      controllers: opts.api ? [PreferencesController, PushController] : [],
      providers: [
        PreferencesService,
        RecipientResolver,
        PushService,
        InAppChannel,
        EmailChannel,
        PushChannel,
        {
          provide: CHANNELS,
          inject: [InAppChannel, EmailChannel, PushChannel, PushService],
          // Push only when VAPID keys are configured.
          useFactory: (inapp: NotificationChannel, email: NotificationChannel, push: NotificationChannel, svc: PushService) =>
            svc.enabled ? [inapp, email, push] : [inapp, email],
        },
        Dispatcher,
        AlarmNotifier,
        ...(opts.worker ? [NotifyProcessor] : []),
      ],
      exports: [Dispatcher, RecipientResolver, PreferencesService, PushService],
    };
  }
}
