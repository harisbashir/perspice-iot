import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@perspice/shared';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from './require.decorator';
import { RolesService } from './roles.service';

const PermissionList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

const CreateRole = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(['platform', 'customer']),
  customerId: z.string().uuid().nullish(),
  permissions: PermissionList,
});

const UpdateRole = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  permissions: PermissionList.optional(),
});

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Require('user.read')
  list(@CurrentUser() actor: AuthUser) {
    return this.roles.list(actor);
  }

  @Post()
  @Require('role.manage')
  @Audited('role.create', 'role')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.roles.create(actor, CreateRole.parse(raw));
  }

  @Patch(':id')
  @Require('role.manage')
  @Audited('role.update', 'role')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.roles.update(actor, id, UpdateRole.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('role.manage')
  @Audited('role.delete', 'role')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.roles.remove(actor, id);
  }
}
