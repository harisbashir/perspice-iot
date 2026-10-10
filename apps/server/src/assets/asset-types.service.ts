import { Inject, Injectable } from '@nestjs/common';
import { type AssetTypeDto, AssetTypeInputSchema } from '@perspice/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { conflict, notFound } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { asset, assetType } from '../db/schema';

type TypeRow = typeof assetType.$inferSelect;

/** Asset types (platform-managed, used by every customer). */
@Injectable()
export class AssetTypesService {
  constructor(@Inject(DB) private readonly db: DB) {}

  async list(): Promise<AssetTypeDto[]> {
    const rows = await this.db
      .select({ t: assetType, count: sql<number>`(SELECT count(*)::int FROM ${asset} WHERE ${asset.typeId} = ${assetType.id})` })
      .from(assetType)
      .orderBy(asc(assetType.name));
    return rows.map((r) => toDto(r.t, r.count));
  }

  async get(id: string): Promise<TypeRow> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.assetType.findFirst({ where: eq(assetType.id, id) });
    if (!row) throw notFound();
    return row;
  }

  async create(body: unknown): Promise<AssetTypeDto> {
    const input = AssetTypeInputSchema.parse(body);
    const [row] = await this.db.insert(assetType).values(input).returning();
    return toDto(row!, 0);
  }

  async update(id: string, body: unknown): Promise<AssetTypeDto> {
    await this.get(id);
    const input = AssetTypeInputSchema.partial().parse(body);
    const [row] = await this.db.update(assetType).set({ ...input, updatedAt: new Date() }).where(eq(assetType.id, id)).returning();
    return (await this.list()).find((t) => t.id === row!.id)!;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    const used = await this.db.query.asset.findFirst({ where: eq(asset.typeId, id), columns: { id: true } });
    if (used) throw conflict('Assets of this type exist');
    await this.db.delete(assetType).where(eq(assetType.id, id));
  }
}

function toDto(r: TypeRow, assetCount: number): AssetTypeDto {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    attributes: r.attributes,
    defaultDashboardTemplateId: r.defaultDashboardTemplateId,
    assetCount,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}
