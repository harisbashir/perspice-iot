import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { WebhooksService } from './webhooks.service';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('webhooks')
  @Require('webhook.manage')
  list(@CurrentUser() actor: AuthUser) {
    return this.webhooks.list(actor);
  }

  /** The response includes the signing secret; it is never shown again. */
  @Post('webhooks')
  @Require('webhook.manage')
  @Audited('webhook.create', 'webhook')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.webhooks.create(actor, body);
  }

  @Put('webhooks/:id')
  @Require('webhook.manage')
  @Audited('webhook.update', 'webhook', { targetIdFrom: 'param' })
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.webhooks.update(actor, id, body);
  }

  @Delete('webhooks/:id')
  @Require('webhook.manage')
  @HttpCode(204)
  @Audited('webhook.delete', 'webhook', { targetIdFrom: 'param' })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.webhooks.remove(actor, id);
  }

  @Post('webhooks/:id/rotate-secret')
  @Require('webhook.manage')
  @HttpCode(200)
  @Audited('webhook.rotate_secret', 'webhook', { targetIdFrom: 'param' })
  rotate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.rotateSecret(actor, id);
  }

  @Post('webhooks/:id/test')
  @Require('webhook.manage')
  @HttpCode(200)
  test(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.webhooks.test(actor, id);
  }

  @Get('settings/webhooks')
  @Require('system.settings')
  policy() {
    return this.webhooks.getPolicy();
  }

  @Put('settings/webhooks')
  @Require('system.settings')
  @Audited('settings.webhooks', 'setting')
  setPolicy(@Body() body: unknown) {
    return this.webhooks.setPolicy(body);
  }
}
