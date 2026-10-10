import { Inject, Injectable } from '@nestjs/common';
import {
  ASSET_MAX_DEPTH,
  type AlarmSeverity,
  type AssetDto,
  AssetInputSchema,
  AssetPatchSchema,
  type AssetRollup,
  type AssetTreeRow,
  type DeviceDto,
  checkAssetAttributes,
} from '@perspice/shared';
import { type SQL, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { conflict, notFound, validation } from '../common/app-error';
import { CustomersService } from '../customers/customers.service';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { asset, assetDevice, device } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { type Scope, ScopeService, scoped } from '../rbac/scope';
import { AssetTypesService } from './asset-types.service';

type AssetRow = typeof asset.$inferSelect;
const SEVERITY_RANK: AlarmSeverity[] = ['warning', 'minor', 'major', 'critical'];

/**
 * Assets (spec §4, §11): a tree per customer, scoped like devices (customer and group). Parents,
 * devices and the asset always share a customer; the tree can't loop and stays shallow.
 */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly scopes: ScopeService,
    private readonly types: AssetTypesService,
    private readonly customers: CustomersService,
    private readonly devices: DevicesService,
  ) {}

  /** An asset in the actor's scope, else 404. */
  async find(actor: AuthUser, id: string): Promise<AssetRow> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db.select().from(asset).where(scoped(asset, await this.scopes.forUser(actor), eq(asset.id, id))).limit(1);
    if (!row) throw notFound();
    return row;
  }

  async get(actor: AuthUser, id: string): Promise<AssetDto> {
    return this.toDto(await this.find(actor, id));
  }

  async create(actor: AuthUser, body: unknown): Promise<AssetDto> {
    const input = AssetInputSchema.parse(body);
    const scope = await this.scopes.forUser(actor);
    let customerId: string;
    if (scope.kind === 'customer') customerId = scope.customerId;
    else {
      if (!input.customerId) throw validation([{ path: ['customerId'], message: 'Choose the customer' }]);
      customerId = (await this.customers.get(input.customerId)).id;
    }
    const type = await this.types.get(input.typeId).catch(() => {
      throw validation([{ path: ['typeId'], message: 'No such asset type' }]);
    });
    this.checkAttributes(type.attributes, input.attributes);
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.find(actor, input.parentId);
      if (parent.customerId !== customerId) throw notFound();
      if ((await this.depthOf(parent.id)) + 1 > ASSET_MAX_DEPTH) throw validation([{ path: ['parentId'], message: `Assets nest at most ${ASSET_MAX_DEPTH} deep` }]);
      parentId = parent.id;
    }
    const groupId = await this.groupFor(scope, customerId, input.groupId);
    const [row] = await this.db
      .insert(asset)
      .values({ customerId, groupId, typeId: type.id, parentId, name: input.name, location: input.location ?? null, attributes: input.attributes })
      .returning();
    return this.toDto(row!);
  }

  async update(actor: AuthUser, id: string, body: unknown): Promise<AssetDto> {
    const patch = AssetPatchSchema.parse(body);
    const existing = await this.find(actor, id);
    const set: Partial<typeof asset.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.location !== undefined) set.location = patch.location ?? null;
    if (patch.attributes !== undefined) {
      const type = await this.types.get(existing.typeId);
      const merged = { ...existing.attributes, ...patch.attributes };
      this.checkAttributes(type.attributes, merged);
      set.attributes = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null));
    }
    if (patch.groupId !== undefined) set.groupId = await this.groupFor(await this.scopes.forUser(actor), existing.customerId, patch.groupId);
    if (patch.parentId !== undefined && patch.parentId !== existing.parentId) set.parentId = await this.checkMove(actor, existing, patch.parentId ?? null);
    const [row] = await this.db.update(asset).set(set).where(eq(asset.id, id)).returning();
    return this.toDto(row!);
  }

  /** Assets with sub-assets can't be deleted; devices are detached. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const a = await this.find(actor, id);
    const child = await this.db.query.asset.findFirst({ where: eq(asset.parentId, a.id), columns: { id: true } });
    if (child) throw conflict('Move or delete its sub-assets first');
    await this.db.delete(asset).where(eq(asset.id, a.id));
  }

  /** Every asset in scope (flat; the client nests it) with its subtree roll-up. */
  async tree(actor: AuthUser, customerId?: string): Promise<AssetTreeRow[]> {
    const scope = await this.scopes.forUser(actor);
    const where = scoped(asset, scope, scope.kind === 'platform' && customerId ? eq(asset.customerId, customerId) : undefined);
    const rows = await this.db.select().from(asset).where(where).orderBy(asc(asset.name));
    if (!rows.length) return [];
    const rollups = await this.rollups(rows.map((r) => r.id), scope);
    return rows.map((r) => ({ id: r.id, name: r.name, typeId: r.typeId, parentId: r.parentId, customerId: r.customerId, rollup: rollups.get(r.id) ?? emptyRollup() }));
  }

  /** The asset's devices in scope: attached directly, or anywhere in its subtree. */
  async devicesOf(actor: AuthUser, id: string, raw: unknown): Promise<DeviceDto[]> {
    const { depth } = z.object({ depth: z.enum(['children', 'subtree']).default('subtree') }).parse(raw ?? {});
    const a = await this.find(actor, id);
    const ids = await this.deviceIds(a.id, depth, await this.scopes.forUser(actor));
    if (!ids.length) return [];
    const rows = await this.db.select().from(device).where(inArray(device.id, ids)).orderBy(asc(device.name));
    return this.devices.toDtos(rows);
  }

  /** Device ids of an asset (direct or subtree), within the scope. Used by asset dashboards. */
  async deviceIds(assetId: string, depth: 'children' | 'subtree', scope: Scope): Promise<string[]> {
    const ids = depth === 'children' ? [assetId] : await this.subtreeIds([assetId]);
    const rows = await this.db
      .select({ id: device.id })
      .from(assetDevice)
      .innerJoin(device, eq(device.id, assetDevice.deviceId))
      .where(scoped(device, scope, inArray(assetDevice.assetId, ids)));
    return rows.map((r) => r.id);
  }

  /** Attaches a device to an asset of its customer, or detaches it (null). */
  async attach(actor: AuthUser, deviceId: string, raw: unknown): Promise<{ asset: AssetDto | null }> {
    const { assetId } = z.object({ assetId: z.string().uuid().nullable() }).parse(raw ?? {});
    const d = await this.devices.find(actor, deviceId);
    if (!assetId) {
      await this.db.delete(assetDevice).where(eq(assetDevice.deviceId, d.id));
      return { asset: null };
    }
    const a = await this.find(actor, assetId);
    if (a.customerId !== d.customerId) throw notFound();
    await this.db.insert(assetDevice).values({ deviceId: d.id, assetId: a.id }).onConflictDoUpdate({ target: assetDevice.deviceId, set: { assetId: a.id } });
    return { asset: await this.toDto(a) };
  }

  /** The device's asset with its breadcrumb (null when none, or not visible to the actor). */
  async assetOf(actor: AuthUser, deviceId: string): Promise<{ asset: { id: string; name: string; path: { id: string; name: string }[] } | null }> {
    const d = await this.devices.find(actor, deviceId);
    const link = await this.db.query.assetDevice.findFirst({ where: eq(assetDevice.deviceId, d.id) });
    if (!link) return { asset: null };
    const a = await this.find(actor, link.assetId).catch(() => null);
    return { asset: a ? { id: a.id, name: a.name, path: await this.path(a.id) } : null };
  }

  private checkAttributes(defs: Parameters<typeof checkAssetAttributes>[0], values: Record<string, unknown>): void {
    const issues = checkAssetAttributes(defs, values);
    if (issues.length) throw validation(issues.map((i) => ({ path: ['attributes', i.key], message: i.message })));
  }

  /** The group must be the customer's (and, for a group-limited user, one of theirs; default theirs). */
  private async groupFor(scope: Scope, customerId: string, groupId: string | null | undefined): Promise<string | null> {
    const limited = scope.kind === 'customer' ? scope.groupIds : null;
    const chosen = groupId ?? (limited ? limited[0]! : null);
    if (!chosen) return null;
    await this.customers.getGroup(customerId, chosen);
    if (limited && !limited.includes(chosen)) throw validation([{ path: ['groupId'], message: 'Choose one of your groups' }]);
    return chosen;
  }

  /** A new parent can't be the asset or below it, must share the customer, and keep the depth. */
  private async checkMove(actor: AuthUser, a: AssetRow, parentId: string | null): Promise<string | null> {
    if (!parentId) return null;
    const below = await this.subtreeIds([a.id]);
    if (below.includes(parentId)) throw validation([{ path: ['parentId'], message: "An asset can't move inside itself" }]);
    const parent = await this.find(actor, parentId);
    if (parent.customerId !== a.customerId) throw notFound();
    const height = await this.heightOf(a.id);
    if ((await this.depthOf(parent.id)) + height > ASSET_MAX_DEPTH) throw validation([{ path: ['parentId'], message: `Assets nest at most ${ASSET_MAX_DEPTH} deep` }]);
    return parent.id;
  }

  /** 1 for a root asset. */
  private async depthOf(id: string): Promise<number> {
    return (await this.path(id)).length + 1;
  }

  /** Levels in the subtree (1 for a leaf). */
  private async heightOf(id: string): Promise<number> {
    const res = await this.db.execute<{ h: number }>(sql`
      WITH RECURSIVE sub(id, lvl) AS (
        SELECT ${id}::uuid, 1
        UNION ALL SELECT c.id, sub.lvl + 1 FROM ${asset} c JOIN sub ON c.parent_id = sub.id WHERE sub.lvl < ${ASSET_MAX_DEPTH + 1}
      ) SELECT max(lvl)::int AS h FROM sub`);
    return res.rows[0]?.h ?? 1;
  }

  private async subtreeIds(roots: string[]): Promise<string[]> {
    const res = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE sub(id, lvl) AS (
        SELECT a.id, 1 FROM ${asset} a WHERE a.id IN (${sql.join(roots.map((r) => sql`${r}::uuid`), sql`, `)})
        UNION ALL SELECT c.id, sub.lvl + 1 FROM ${asset} c JOIN sub ON c.parent_id = sub.id WHERE sub.lvl < ${ASSET_MAX_DEPTH + 1}
      ) SELECT DISTINCT id FROM sub`);
    return res.rows.map((r) => r.id);
  }

  /** Ancestors from the root. */
  private async path(id: string): Promise<{ id: string; name: string }[]> {
    const res = await this.db.execute<{ id: string; name: string; lvl: number }>(sql`
      WITH RECURSIVE up(id, name, parent_id, lvl) AS (
        SELECT p.id, p.name, p.parent_id, 1 FROM ${asset} a JOIN ${asset} p ON p.id = a.parent_id WHERE a.id = ${id}::uuid
        UNION ALL SELECT p.id, p.name, p.parent_id, up.lvl + 1 FROM ${asset} p JOIN up ON p.id = up.parent_id WHERE up.lvl < ${ASSET_MAX_DEPTH + 1}
      ) SELECT id, name, lvl FROM up ORDER BY lvl DESC`);
    return res.rows.map((r) => ({ id: r.id, name: r.name }));
  }

  /** Devices (in scope) and their open alarms over each asset's subtree. */
  private async rollups(ids: string[], scope: Scope): Promise<Map<string, AssetRollup>> {
    const deviceScope: SQL | undefined = scoped(device, scope);
    const res = await this.db.execute<{ root: string; devices: number; online: number; offline: number; dead: number; never: number; alarms: number; worst: number | null }>(sql`
      WITH RECURSIVE sub(root, id, lvl) AS (
        SELECT a.id, a.id, 1 FROM ${asset} a WHERE a.id IN (${sql.join(ids.map((r) => sql`${r}::uuid`), sql`, `)})
        UNION ALL SELECT sub.root, c.id, sub.lvl + 1 FROM ${asset} c JOIN sub ON c.parent_id = sub.id WHERE sub.lvl < ${ASSET_MAX_DEPTH + 1}
      ),
      devs AS (
        SELECT sub.root, ${device.id} AS device_id, ${device.status} AS status
        FROM sub JOIN ${assetDevice} ad ON ad.asset_id = sub.id JOIN ${device} ON ${device.id} = ad.device_id
        ${deviceScope ? sql`WHERE ${deviceScope}` : sql``}
      ),
      open_alarms AS (
        SELECT devs.root, count(al.id)::int AS n,
          max(CASE al.severity WHEN 'critical' THEN 3 WHEN 'major' THEN 2 WHEN 'minor' THEN 1 ELSE 0 END) AS worst
        FROM devs JOIN alarm al ON al.device_id = devs.device_id AND al.status <> 'cleared'
        GROUP BY devs.root
      )
      SELECT d.root,
        count(*)::int AS devices,
        count(*) FILTER (WHERE d.status = 'online')::int AS online,
        count(*) FILTER (WHERE d.status = 'offline')::int AS offline,
        count(*) FILTER (WHERE d.status = 'dead')::int AS dead,
        count(*) FILTER (WHERE d.status = 'never')::int AS never,
        coalesce(max(oa.n), 0)::int AS alarms,
        max(oa.worst) AS worst
      FROM devs d LEFT JOIN open_alarms oa ON oa.root = d.root
      GROUP BY d.root`);
    return new Map(
      res.rows.map((r) => [
        r.root,
        { devices: r.devices, online: r.online, offline: r.offline, dead: r.dead, never: r.never, alarms: r.alarms, worstSeverity: r.worst === null ? null : SEVERITY_RANK[Number(r.worst)]! },
      ]),
    );
  }

  private async toDto(r: AssetRow): Promise<AssetDto> {
    const type = await this.types.get(r.typeId);
    return {
      id: r.id,
      name: r.name,
      typeId: r.typeId,
      typeName: type.name,
      customerId: r.customerId,
      groupId: r.groupId,
      parentId: r.parentId,
      location: r.location ?? null,
      attributes: r.attributes,
      path: await this.path(r.id),
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    };
  }
}

const emptyRollup = (): AssetRollup => ({ devices: 0, online: 0, offline: 0, dead: 0, never: 0, alarms: 0, worstSeverity: null });
