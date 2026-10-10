import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { forbidden } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { CreateProfile, UpdateProfile } from './profile.schema';
import { ProfilesService, toProfileDto } from './profiles.service';

const platformOnly = (actor: AuthUser) => {
  if (actor.scopeType !== 'platform') throw forbidden();
};

@Controller('device-profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @Require('profile.read')
  list(@CurrentUser() actor: AuthUser) {
    return this.profiles.list(actor);
  }

  @Get(':id')
  @Require('profile.read')
  async get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return toProfileDto(await this.profiles.get(actor, id));
  }

  @Post()
  @Require('profile.write')
  @Audited('profile.create', 'device_profile')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    platformOnly(actor);
    return this.profiles.create(CreateProfile.parse(raw));
  }

  @Patch(':id')
  @Require('profile.write')
  @Audited('profile.update', 'device_profile')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    platformOnly(actor);
    return this.profiles.update(actor, id, UpdateProfile.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('profile.write')
  @Audited('profile.delete', 'device_profile')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    platformOnly(actor);
    await this.profiles.remove(actor, id);
  }
}
