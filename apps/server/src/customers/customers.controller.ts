import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { forbidden } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { CustomersService } from './customers.service';

export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

const CreateCustomer = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(SLUG_PATTERN, 'Use 3–40 lowercase letters, digits or hyphens'),
  status: z.enum(['active', 'suspended']).optional(),
});
const UpdateCustomer = CreateCustomer.partial();
const GroupBody = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().nullish(),
});

const platformOnly = (actor: AuthUser) => {
  if (actor.scopeType !== 'platform') throw forbidden();
};

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Require('customer.read')
  list(@CurrentUser() actor: AuthUser, @Query('search') search?: string) {
    platformOnly(actor);
    return this.customers.list(search);
  }

  @Get(':id')
  @Require('customer.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    platformOnly(actor);
    return this.customers.get(id);
  }

  @Post()
  @Require('customer.manage')
  @Audited('customer.create', 'customer')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    platformOnly(actor);
    return this.customers.create(CreateCustomer.parse(raw));
  }

  @Patch(':id')
  @Require('customer.manage')
  @Audited('customer.update', 'customer')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    platformOnly(actor);
    return this.customers.update(id, UpdateCustomer.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('customer.manage')
  @Audited('customer.delete', 'customer')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    platformOnly(actor);
    await this.customers.remove(id);
  }

  @Get(':id/groups')
  @Require('user.read')
  listGroups(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.customers.listGroups(actor, id);
  }

  @Post(':id/groups')
  @Require('user.manage')
  @Audited('customer_group.create', 'customer_group')
  createGroup(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.customers.createGroup(actor, id, GroupBody.parse(raw));
  }

  @Patch(':id/groups/:groupId')
  @Require('user.manage')
  @Audited('customer_group.update', 'customer_group')
  updateGroup(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() raw: unknown,
  ) {
    return this.customers.updateGroup(actor, id, groupId, GroupBody.partial().parse(raw));
  }

  @Delete(':id/groups/:groupId')
  @HttpCode(204)
  @Require('user.manage')
  @Audited('customer_group.delete', 'customer_group')
  async removeGroup(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Param('groupId') groupId: string) {
    await this.customers.removeGroup(actor, id, groupId);
  }
}
