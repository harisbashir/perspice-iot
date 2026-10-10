import { Inject, Injectable } from '@nestjs/common';
import { type DashboardDefinition, DashboardDefinitionSchema } from '@perspice/shared';
import { and, asc, eq, exists } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { assetType, dashboardInstance, dashboardTemplate, deviceProfile } from '../db/schema';
import { backfillInstances } from './assignment';
import { generateDeviceDefinition } from './defaults';
import { remapKeys } from './key-mapping';

type TemplateRow = typeof dashboardTemplate.$inferSelect;

export interface TemplateDto {
  id: string;
  name: string;
  kind: 'device' | 'overview' | 'asset';
  profileId: string | null;
  assetTypeId: string | null;
  definition: DashboardDefinition;
  version: number;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toTemplateDto = (t: TemplateRow): TemplateDto => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  profileId: t.profileId,
  assetTypeId: t.assetTypeId,
  definition: t.definition,
  version: t.version,
  builtIn: t.builtIn,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const EXPORT_FORMAT = 'perspice-dashboard';

export const ExportEnvelope = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  template: z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['device', 'overview', 'asset']),
    definition: DashboardDefinitionSchema,
  }),
});

export interface CreateTemplateInput {
  name: string;
  kind: 'device' | 'overview' | 'asset';
  profileId?: string | null;
  assetTypeId?: string | null;
  definition: DashboardDefinition;
  builtIn?: boolean;
}

const platformOnly = (actor: AuthUser) => {
  if (actor.scopeType !== 'platform') throw forbidden();
};

@Injectable()
export class TemplatesService {
  constructor(@Inject(DB) private readonly db: DB) {}

  /** Platform users see every template; customers only those behind one of their dashboards. */
  async list(actor: AuthUser, q: { kind?: 'device' | 'overview' | 'asset'; profileId?: string; assetTypeId?: string } = {}): Promise<TemplateDto[]> {
    const rows = await this.db
      .select()
      .from(dashboardTemplate)
      .where(
        and(
          q.kind ? eq(dashboardTemplate.kind, q.kind) : undefined,
          q.profileId ? eq(dashboardTemplate.profileId, q.profileId) : undefined,
          q.assetTypeId ? eq(dashboardTemplate.assetTypeId, q.assetTypeId) : undefined,
          this.visible(actor),
        ),
      )
      .orderBy(asc(dashboardTemplate.name));
    return rows.map(toTemplateDto);
  }

  async get(actor: AuthUser, id: string): Promise<TemplateRow> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(dashboardTemplate)
      .where(and(eq(dashboardTemplate.id, id), this.visible(actor)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  async create(actor: AuthUser, input: CreateTemplateInput): Promise<TemplateDto> {
    platformOnly(actor);
    const { profileId, assetTypeId } = await this.checkKind(input.kind, input.profileId ?? null, input.assetTypeId ?? null);
    const [row] = await this.db
      .insert(dashboardTemplate)
      .values({
        name: input.name,
        kind: input.kind,
        profileId,
        assetTypeId,
        definition: DashboardDefinitionSchema.parse(input.definition),
        builtIn: input.builtIn ?? false,
      })
      .returning();
    return toTemplateDto(row!);
  }

  /** Any definition change bumps the version so customised instances can detect drift. */
  async update(actor: AuthUser, id: string, patch: { name?: string; definition?: DashboardDefinition }): Promise<TemplateDto> {
    platformOnly(actor);
    const existing = await this.get(actor, id);
    const set: Partial<typeof dashboardTemplate.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.definition !== undefined) {
      set.definition = DashboardDefinitionSchema.parse(patch.definition);
      set.version = existing.version + 1;
    }
    const [row] = await this.db.update(dashboardTemplate).set(set).where(eq(dashboardTemplate.id, id)).returning();
    return toTemplateDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    platformOnly(actor);
    const existing = await this.get(actor, id);
    if (existing.builtIn) throw forbidden('Built-in templates cannot be deleted');
    await this.db.delete(dashboardTemplate).where(eq(dashboardTemplate.id, id));
  }

  async clone(
    actor: AuthUser,
    id: string,
    input: { name: string; profileId?: string | null; keyMapping?: Record<string, string> },
  ): Promise<TemplateDto> {
    const src = await this.get(actor, id);
    return this.create(actor, {
      name: input.name,
      kind: src.kind,
      profileId: input.profileId === undefined ? src.profileId : input.profileId,
      assetTypeId: src.assetTypeId,
      definition: input.keyMapping ? remapKeys(src.definition, input.keyMapping) : src.definition,
    });
  }

  async export(actor: AuthUser, id: string): Promise<z.infer<typeof ExportEnvelope>> {
    const t = await this.get(actor, id);
    return { format: EXPORT_FORMAT, version: 1, template: { name: t.name, kind: t.kind, definition: t.definition } };
  }

  async import(actor: AuthUser, envelope: unknown, profileId: string | null, assetTypeId: string | null = null): Promise<TemplateDto> {
    const parsed = ExportEnvelope.safeParse(envelope);
    if (!parsed.success) throw validation(parsed.error.issues, 'Not a valid dashboard export');
    return this.create(actor, { ...parsed.data.template, profileId, assetTypeId });
  }

  async setProfileDefault(actor: AuthUser, profileId: string, templateId: string | null): Promise<void> {
    platformOnly(actor);
    if (!isUuid(profileId)) throw notFound();
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) });
    if (!profile) throw notFound();
    if (templateId) {
      const t = await this.get(actor, templateId);
      if (t.kind !== 'device' || t.profileId !== profileId) {
        throw validation([{ path: ['templateId'], message: "Use a device template made for this profile" }]);
      }
    }
    await this.db.update(deviceProfile).set({ defaultDashboardTemplateId: templateId }).where(eq(deviceProfile.id, profileId));
    if (templateId) await backfillInstances(this.db, profileId, templateId);
  }

  /** Creates "<profile> dashboard" from the profile's keys and commands and makes it the default. */
  async generateForProfile(actor: AuthUser, profileId: string): Promise<TemplateDto> {
    platformOnly(actor);
    if (!isUuid(profileId)) throw notFound();
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) });
    if (!profile) throw notFound();
    const tpl = await this.create(actor, {
      name: `${profile.name} dashboard`,
      kind: 'device',
      profileId,
      definition: generateDeviceDefinition(profile),
    });
    await this.setProfileDefault(actor, profileId, tpl.id);
    return tpl;
  }

  private visible(actor: AuthUser) {
    if (actor.scopeType === 'platform') return undefined;
    return exists(
      this.db
        .select({ id: dashboardInstance.id })
        .from(dashboardInstance)
        .where(and(eq(dashboardInstance.templateId, dashboardTemplate.id), eq(dashboardInstance.customerId, actor.customerId!))),
    );
  }

  private async checkKind(kind: 'device' | 'overview' | 'asset', profileId: string | null, assetTypeId: string | null): Promise<{ profileId: string | null; assetTypeId: string | null }> {
    if (kind !== 'asset' && assetTypeId) throw validation([{ path: ['assetTypeId'], message: 'Only asset templates are bound to an asset type' }]);
    if (kind === 'overview') {
      if (profileId) throw validation([{ path: ['profileId'], message: 'Overview templates are not bound to a profile' }]);
      return { profileId: null, assetTypeId: null };
    }
    if (kind === 'asset') {
      if (profileId) throw validation([{ path: ['profileId'], message: 'Asset templates are not bound to a profile' }]);
      if (!assetTypeId) throw validation([{ path: ['assetTypeId'], message: 'Asset templates need an asset type' }]);
      if (!isUuid(assetTypeId) || !(await this.db.query.assetType.findFirst({ where: eq(assetType.id, assetTypeId) }))) throw notFound();
      return { profileId: null, assetTypeId };
    }
    if (!profileId) throw validation([{ path: ['profileId'], message: 'Device templates need a profile' }]);
    if (!isUuid(profileId) || !(await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) }))) {
      throw notFound();
    }
    return { profileId, assetTypeId: null };
  }

}
