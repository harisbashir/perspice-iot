import { Body, Controller, Get, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { PreferencesService } from './preferences.service';

/** The signed-in user's own notification settings and timezone. */
@Controller('me/notification-preferences')
export class PreferencesController {
  constructor(private readonly prefs: PreferencesService) {}

  @Get()
  get(@CurrentUser() actor: AuthUser) {
    return this.prefs.view(actor.id);
  }

  @Put()
  update(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.prefs.update(actor.id, body);
  }
}
