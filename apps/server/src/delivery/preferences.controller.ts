import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { notFound } from '../common/app-error';
import { Dispatcher } from './dispatcher';
import { PreferencesService } from './preferences.service';
import { RecipientResolver } from './recipients';

/** The signed-in user's own notification settings and timezone. */
@Controller('me/notification-preferences')
export class PreferencesController {
  constructor(
    private readonly prefs: PreferencesService,
    private readonly dispatcher: Dispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @Get()
  get(@CurrentUser() actor: AuthUser) {
    return this.prefs.view(actor.id);
  }

  @Put()
  update(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.prefs.update(actor.id, body);
  }

  /** Sends a test notification on each channel the user has switched on (ignoring level and quiet hours). */
  @Post('test')
  @HttpCode(202)
  async test(@CurrentUser() actor: AuthUser) {
    const me = await this.recipients.self(actor.id);
    if (!me) throw notFound();
    const queued = await this.dispatcher.dispatch(
      [me],
      { type: 'test', level: 'info', title: 'Test notification', body: 'Notifications reach you here.', link: '/settings/notifications', customerId: me.customerId, email: { template: 'test', vars: {} } },
      ['inapp', 'email', 'push'],
      Date.now(),
      { ignoreLevelAndQuiet: true },
    );
    return { queued };
  }
}
