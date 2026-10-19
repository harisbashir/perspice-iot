import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AlarmNotifier } from './alarm-notifier';
import { DeliveryLogController } from './delivery-log.controller';
import { DigestJob } from './digest.job';
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
import { WebhookEvents } from './webhook-events';
import { WebhookSender } from './webhook-sender';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { CHANNELS, type NotificationChannel } from './types';

@Global()
@Module({})
export class DeliveryModule {
  static forRoot(opts: { api: boolean; worker: boolean; scheduler: boolean; rules: boolean }): DynamicModule {
    return {
      module: DeliveryModule,
      controllers: opts.api ? [PreferencesController, PushController, WebhooksController, DeliveryLogController] : [],
      providers: [
        PreferencesService,
        RecipientResolver,
        PushService,
        InAppChannel,
        EmailChannel,
        PushChannel,
        {
          provide: CHANNELS,
          inject: [InAppChannel, EmailChannel, PushChannel],
          // Push is skipped per message while no VAPID keys are set up (see Dispatcher).
          useFactory: (inapp: NotificationChannel, email: NotificationChannel, push: NotificationChannel) => [inapp, email, push],
        },
        Dispatcher,
        AlarmNotifier,
        WebhookSender,
        WebhooksService,
        WebhookEvents,
        { provide: 'CONSUME_STATUS_FOR_WEBHOOKS', useValue: opts.rules },
        DigestJob,
        { provide: 'SCHEDULE_DELIVERY_JOBS', useValue: opts.scheduler },
        ...(opts.worker ? [NotifyProcessor] : []),
      ],
      exports: [Dispatcher, RecipientResolver, PreferencesService, PushService, DigestJob, WebhooksService],
    };
  }
}
