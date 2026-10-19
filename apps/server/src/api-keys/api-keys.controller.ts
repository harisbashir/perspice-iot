import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@perspice/shared';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ApiKeysService } from './api-keys.service';

const CreateKey = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  expiresAt: z.number().int().optional(),
});

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  /** Your own keys; `?scope=organisation`: every key in your scope (needs `user.manage`). */
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('scope') scope?: string) {
    return scope === 'organisation' ? this.keys.listOrganisation(actor) : this.keys.list(actor);
  }

  @Post()
  @Audited('api_key.create', 'api_key')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.keys.create(actor, CreateKey.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Audited('api_key.delete', 'api_key')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.keys.remove(actor, id);
  }
}
