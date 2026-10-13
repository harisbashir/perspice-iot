import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { forbidden } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { UsersService } from './users.service';

const ListQuery = z.object({
  search: z.string().max(200).optional(),
  customerId: z.string().uuid().optional(),
  scopeType: z.enum(['platform', 'customer']).optional(),
});

const InviteBody = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(200),
  roleId: z.string().uuid(),
  customerId: z.string().uuid().nullish(),
  groupId: z.string().uuid().nullish(),
});

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  groupId: z.string().uuid().nullable().optional(),
});

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Require('user.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.users.list(actor, ListQuery.parse(raw));
  }

  @Get(':id')
  @Require('user.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.get(actor, id);
  }

  @Post('invite')
  @Require('user.manage')
  @Audited('user.invite', 'user')
  invite(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.users.invite(actor, InviteBody.parse(raw));
  }

  /** Anyone may rename themselves; changing other users needs `user.manage`. */
  @Patch(':id')
  @Audited('user.update', 'user')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    const body = UpdateBody.parse(raw);
    if (id !== actor.id && !actor.permissions.includes('user.manage')) throw forbidden('Missing permission');
    return this.users.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('user.manage')
  @Audited('user.delete', 'user')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.users.remove(actor, id);
  }

  @Post(':id/invite-link')
  @Require('user.manage')
  @Audited('user.invite_link', 'user')
  inviteLink(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.newInviteLink(actor, id);
  }

  @Post(':id/resend-invite')
  @HttpCode(204)
  @Require('user.manage')
  @Audited('user.resend_invite', 'user')
  async resendInvite(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.users.resendInvite(actor, id);
  }
}
