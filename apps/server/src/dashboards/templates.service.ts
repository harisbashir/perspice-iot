import { Inject, Injectable } from '@nestjs/common';
import { type DashboardDefinition, DashboardDefinitionSchema } from '@perspice/shared';
import { and, asc, eq, exists } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { dashboardInstance, dashboardTemplate, deviceProfile } from '../db/schema';
import { backfillInstances } from './assignment';
import { generateDeviceDefinition } from './defaults';
import { remapKeys } from './key-mapping';

type TemplateRow = typeof dashboardTemplate.$inferSelect;

export interface TemplateDto {
  id: string;
  name: string;
  kind: 'device' | 'overview';
  profileId: string | null;
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
    kind: z.enum(['device', 'overview']),
    definition: DashboardDefinitionSchema,
  }),
});

export interface CreateTemplateInput {
  name: string;
  kind: 'device' | 'overview';
  profileId?: string | null;
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
  async list(actor: AuthUser, q: { kind?: 'device' | 'overview'; profileId?: string } = {}): Promise<TemplateDto[]> {
    const rows = await this.db
      .select()
      .from(dashboardTemplate)
      .where(
        and(
          q.kind ? eq(dashboardTemplate.kind, q.kind) : undefined,
          q.profileId ? eq(dashboardTemplate.profileId, q.profileId) : undefined,
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
    const profileId = await this.checkKind(input.kind, input.profileId ?? null);
    const [row] = await this.db
      .insert(dashboardTemplate)
      .values({
        name: input.name,
        kind: input.kind,
        profileId,
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
      definition: input.keyMapping ? remapKeys(src.definition, input.keyMapping) : src.definition,
    });
  }

  async export(actor: AuthUser, id: string): Promise<z.infer<typeof ExportEnvelope>> {
    const t = await this.get(actor, id);
    return { format: EXPORT_FORMAT, version: 1, template: { name: t.name, kind: t.kind, definition: t.definition } };
  }

  async import(actor: AuthUser, envelope: unknown, profileId: string | null): Promise<TemplateDto> {
    const parsed = ExportEnvelope.safeParse(envelope);
    if (!parsed.success) throw validation(parsed.error.issues, 'Not a valid dashboard export');
    return this.create(actor, { ...parsed.data.template, profileId });
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

  private async checkKind(kind: 'device' | 'overview', profileId: string | null): Promise<string | null> {
    if (kind === 'overview') {
      if (profileId) throw validation([{ path: ['profileId'], message: 'Overview templates are not bound to a profile' }]);
      return null;
    }
    if (!profileId) throw validation([{ path: ['profileId'], message: 'Device templates need a profile' }]);
    if (!isUuid(profileId) || !(await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId) }))) {
      throw notFound();
    }
    return profileId;
  }
}
