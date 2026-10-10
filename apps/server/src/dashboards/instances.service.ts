import { Inject, Injectable } from '@nestjs/common';
import { type DashboardDefinition, DashboardDefinitionSchema, type DashboardViewDto } from '@perspice/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { assetType, dashboardInstance, dashboardTemplate, deviceProfile } from '../db/schema';
import { AssetsService } from '../assets/assets.service';
import { DevicesService } from '../devices/devices.service';
import { ensureInstance } from './assignment';

type InstanceRow = typeof dashboardInstance.$inferSelect;
type TemplateRow = typeof dashboardTemplate.$inferSelect;

export type DashboardView = DashboardViewDto;

export const toView = (inst: InstanceRow, tpl: TemplateRow): DashboardView => {
  const overridden = inst.overrideDefinition !== null && inst.overrideDefinition !== undefined;
  return {
    instanceId: inst.id,
    templateId: tpl.id,
    templateName: tpl.name,
    templateVersion: tpl.version,
    overridden,
    baseVersion: overridden ? inst.overrideBaseVersion : null,
    outdated: overridden && (inst.overrideBaseVersion ?? 0) < tpl.version,
    definition: overridden ? inst.overrideDefinition! : tpl.definition,
  };
};

@Injectable()
export class InstancesService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly devices: DevicesService,
    private readonly assets: AssetsService,
  ) {}

  /** The dashboard of a device the viewer can see: its customer's instance of the profile default. */
  async forDevice(actor: AuthUser, deviceId: string): Promise<DashboardView | null> {
    const d = await this.devices.find(actor, deviceId);
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, d.profileId) });
    if (!profile?.defaultDashboardTemplateId) return null;
    const tpl = await this.db.query.dashboardTemplate.findFirst({ where: eq(dashboardTemplate.id, profile.defaultDashboardTemplateId) });
    if (!tpl) return null;
    return toView(await ensureInstance(this.db, tpl.id, d.customerId), tpl);
  }

  /** An asset's dashboard: its customer's instance of the asset type's default template. */
  async forAsset(actor: AuthUser, assetId: string): Promise<DashboardView | null> {
    const a = await this.assets.find(actor, assetId);
    const type = await this.db.query.assetType.findFirst({ where: eq(assetType.id, a.typeId) });
    if (!type?.defaultDashboardTemplateId) return null;
    const tpl = await this.db.query.dashboardTemplate.findFirst({ where: eq(dashboardTemplate.id, type.defaultDashboardTemplateId) });
    if (!tpl) return null;
    return toView(await ensureInstance(this.db, tpl.id, a.customerId), tpl);
  }

  /** The built-in overview, as the viewer's portal (platform or their customer) sees it. */
  async overview(actor: AuthUser): Promise<DashboardView | null> {
    const [tpl] = await this.db
      .select()
      .from(dashboardTemplate)
      .where(and(eq(dashboardTemplate.kind, 'overview'), eq(dashboardTemplate.builtIn, true)))
      .orderBy(asc(dashboardTemplate.createdAt))
      .limit(1);
    if (!tpl) return null;
    return toView(await ensureInstance(this.db, tpl.id, actor.scopeType === 'customer' ? actor.customerId : null), tpl);
  }

  async customise(actor: AuthUser, instanceId: string, definition: DashboardDefinition): Promise<DashboardView> {
    const { inst, tpl } = await this.find(actor, instanceId);
    const [row] = await this.db
      .update(dashboardInstance)
      .set({ overrideDefinition: DashboardDefinitionSchema.parse(definition), overrideBaseVersion: tpl.version })
      .where(eq(dashboardInstance.id, inst.id))
      .returning();
    return toView(row!, tpl);
  }

  async resync(actor: AuthUser, instanceId: string): Promise<DashboardView> {
    const { inst, tpl } = await this.find(actor, instanceId);
    const [row] = await this.db
      .update(dashboardInstance)
      .set({ overrideDefinition: null, overrideBaseVersion: null })
      .where(eq(dashboardInstance.id, inst.id))
      .returning();
    return toView(row!, tpl);
  }

  /** Customers may only touch their own instances (404 otherwise); platform users any. */
  private async find(actor: AuthUser, instanceId: string): Promise<{ inst: InstanceRow; tpl: TemplateRow }> {
    if (!isUuid(instanceId)) throw notFound();
    const inst = await this.db.query.dashboardInstance.findFirst({ where: eq(dashboardInstance.id, instanceId) });
    if (!inst) throw notFound();
    if (actor.scopeType === 'customer' && inst.customerId !== actor.customerId) throw notFound();
    if (actor.scopeType === 'customer' && !inst.customerId) throw forbidden();
    const tpl = await this.db.query.dashboardTemplate.findFirst({ where: eq(dashboardTemplate.id, inst.templateId) });
    if (!tpl) throw notFound();
    return { inst, tpl };
  }
}
