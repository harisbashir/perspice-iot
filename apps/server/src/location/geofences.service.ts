import { Inject, Injectable } from '@nestjs/common';
import { type GeofenceDto, GeofenceInputSchema, bboxOf } from '@perspice/shared';
import { and, asc, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { customer, geofence } from '../db/schema';

type Row = typeof geofence.$inferSelect;

export const GeofenceListQuery = z.object({
  /** `minLng,minLat,maxLng,maxLat`: geofences whose bounding box overlaps it. */
  bbox: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .optional(),
  customerId: z.string().uuid().optional(),
});

const toDto = (r: Row): GeofenceDto => ({
  id: r.id,
  name: r.name,
  customerId: r.customerId,
  shape: r.shape,
  color: r.color,
  createdAt: r.createdAt.getTime(),
  updatedAt: r.updatedAt.getTime(),
});

/**
 * Geofences belong to a customer, or (platform scope, `customerId` null) to the whole platform,
 * in which case every customer sees them read-only.
 */
@Injectable()
export class GeofencesService {
  constructor(@Inject(DB) private readonly db: DB) {}

  /** What an actor can see: their customer's and platform-wide ones; platform users see all. */
  visibleTo(actor: AuthUser): SQL | undefined {
    return actor.scopeType === 'customer' ? or(eq(geofence.customerId, actor.customerId!), isNull(geofence.customerId)) : undefined;
  }

  async list(actor: AuthUser, query: z.infer<typeof GeofenceListQuery>): Promise<GeofenceDto[]> {
    const conds: (SQL | undefined)[] = [this.visibleTo(actor)];
    if (query.customerId && actor.scopeType === 'platform') conds.push(or(eq(geofence.customerId, query.customerId), isNull(geofence.customerId)));
    if (query.bbox) {
      const [minLng, minLat, maxLng, maxLat] = query.bbox;
      conds.push(lte(geofence.minLat, maxLat), gte(geofence.maxLat, minLat), lte(geofence.minLng, maxLng), gte(geofence.maxLng, minLng));
    }
    const rows = await this.db.select().from(geofence).where(and(...conds)).orderBy(asc(geofence.name)).limit(2000);
    return rows.map(toDto);
  }

  async get(actor: AuthUser, id: string): Promise<GeofenceDto> {
    return toDto(await this.find(actor, id));
  }

  async create(actor: AuthUser, body: unknown): Promise<GeofenceDto> {
    const input = GeofenceInputSchema.parse(body);
    const customerId = await this.tenantFor(actor, input.customerId);
    const [row] = await this.db
      .insert(geofence)
      .values({ name: input.name, shape: input.shape, color: input.color, customerId, ...bboxColumns(input.shape) })
      .returning();
    return toDto(row!);
  }

  async update(actor: AuthUser, id: string, body: unknown): Promise<GeofenceDto> {
    const existing = await this.findWritable(actor, id);
    const patch = GeofenceInputSchema.omit({ customerId: true }).partial().parse(body);
    const [row] = await this.db
      .update(geofence)
      .set({ ...patch, ...(patch.shape ? bboxColumns(patch.shape) : {}) })
      .where(eq(geofence.id, existing.id))
      .returning();
    return toDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const existing = await this.findWritable(actor, id);
    await this.db.delete(geofence).where(eq(geofence.id, existing.id));
  }

  /** A geofence the actor can see, or 404. */
  async find(actor: AuthUser, id: string): Promise<Row> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db.select().from(geofence).where(and(eq(geofence.id, id), this.visibleTo(actor)));
    if (!row) throw notFound();
    return row;
  }

  private async findWritable(actor: AuthUser, id: string): Promise<Row> {
    const row = await this.find(actor, id);
    if (actor.scopeType === 'customer' && row.customerId === null) throw forbidden('Platform-wide geofences are managed by the platform');
    return row;
  }

  private async tenantFor(actor: AuthUser, requested: string | null | undefined): Promise<string | null> {
    if (actor.scopeType === 'customer') {
      if (requested && requested !== actor.customerId) throw notFound();
      return actor.customerId;
    }
    if (requested && !(await this.db.query.customer.findFirst({ where: eq(customer.id, requested) }))) throw notFound();
    return requested ?? null;
  }
}

function bboxColumns(shape: Parameters<typeof bboxOf>[0]) {
  const b = bboxOf(shape);
  return { minLat: b.minLat, minLng: b.minLng, maxLat: b.maxLat, maxLng: b.maxLng };
}
