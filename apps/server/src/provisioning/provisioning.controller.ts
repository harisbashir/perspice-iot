import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ProvisioningKeyInputSchema } from '@perspice/shared';
import type { Request } from 'express';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { ProvisioningService } from './provisioning.service';

@Controller()
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Get('device-profiles/:id/provisioning-keys')
  @Require('profile.write')
  list(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.provisioning.listKeys(actor, id);
  }

  @Post('device-profiles/:id/provisioning-keys')
  @Require('profile.write')
  @Audited('provisioning_key.create', 'provisioning_key')
  create(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.provisioning.createKey(actor, id, ProvisioningKeyInputSchema.parse(raw));
  }

  @Delete('provisioning-keys/:id')
  @HttpCode(204)
  @Require('profile.write')
  @Audited('provisioning_key.revoke', 'provisioning_key')
  async revoke(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.provisioning.revokeKey(actor, id);
  }

  /** Called by devices on first boot with the key from their firmware; see docs/provisioning.md. */
  @Post('v1/device/provision')
  @Public()
  @HttpCode(201)
  provision(@Req() req: Request, @Body() body: unknown) {
    return this.provisioning.provision(body, req.ip ?? 'unknown');
  }
}
