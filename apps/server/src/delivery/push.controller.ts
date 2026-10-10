import { Body, Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** `publicKey` is null when the server has no VAPID keys (push unavailable). */
  @Get('public-key')
  async publicKey(@CurrentUser() actor: AuthUser) {
    return { publicKey: this.push.publicKey(), subscriptions: await this.push.count(actor.id) };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(@CurrentUser() actor: AuthUser, @Body() body: unknown, @Headers('user-agent') ua?: string) {
    await this.push.subscribe(actor.id, body, ua);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    await this.push.unsubscribe(actor.id, z.object({ endpoint: z.string().max(2000) }).parse(body).endpoint);
  }
}
