import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { DashboardDefinitionSchema } from '@perspice/shared';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { TemplatesService, toTemplateDto } from './templates.service';

const Name = z.string().trim().min(1).max(200);
const CreateBody = z.object({
  name: Name,
  kind: z.enum(['device', 'overview']),
  profileId: z.string().uuid().nullish(),
  definition: DashboardDefinitionSchema,
});
const UpdateBody = z.object({ name: Name.optional(), definition: DashboardDefinitionSchema.optional() });
const CloneBody = z.object({
  name: Name,
  profileId: z.string().uuid().nullish(),
  keyMapping: z.record(z.string().max(64)).optional(),
});
const ImportBody = z.object({ envelope: z.unknown(), profileId: z.string().uuid().nullish() });
const ListQuery = z.object({ kind: z.enum(['device', 'overview']).optional(), profileId: z.string().uuid().optional() });

@Controller()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('dashboard-templates')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.templates.list(actor, ListQuery.parse(raw));
  }

  @Post('dashboard-templates')
  @Require('dashboard.edit')
  @Audited('dashboard_template.create', 'dashboard_template')
  create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.templates.create(actor, CreateBody.parse(raw));
  }

  @Post('dashboard-templates/import')
  @Require('dashboard.edit')
  @Audited('dashboard_template.import', 'dashboard_template')
  import(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = ImportBody.parse(raw);
    return this.templates.import(actor, body.envelope, body.profileId ?? null);
  }

  @Get('dashboard-templates/:id')
  async get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return toTemplateDto(await this.templates.get(actor, id));
  }

  @Patch('dashboard-templates/:id')
  @Require('dashboard.edit')
  @Audited('dashboard_template.update', 'dashboard_template')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.templates.update(actor, id, UpdateBody.parse(raw));
  }

  @Delete('dashboard-templates/:id')
  @HttpCode(204)
  @Require('dashboard.edit')
  @Audited('dashboard_template.delete', 'dashboard_template')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.templates.remove(actor, id);
  }

  @Post('dashboard-templates/:id/clone')
  @Require('dashboard.edit')
  @Audited('dashboard_template.clone', 'dashboard_template')
  clone(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.templates.clone(actor, id, CloneBody.parse(raw));
  }

  @Get('dashboard-templates/:id/export')
  export(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.templates.export(actor, id);
  }

  @Post('device-profiles/:id/generate-dashboard')
  @Require('dashboard.edit')
  @Audited('dashboard_template.generate', 'dashboard_template')
  generate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.templates.generateForProfile(actor, id);
  }

  @Put('device-profiles/:id/default-dashboard')
  @Require('dashboard.edit')
  @Audited('profile.default_dashboard', 'device_profile', { targetIdFrom: 'param' })
  async setDefault(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    const { templateId } = z.object({ templateId: z.string().uuid().nullable() }).parse(raw);
    await this.templates.setProfileDefault(actor, id, templateId);
    return { profileId: id, templateId };
  }
}
