import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { tenantCacheKey } from '../auth/tenant-host.middleware';
import { conflict, notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { isUuid } from '../db/scoped-repo';
import { customer, customerGroup, device } from '../db/schema';
import { ScopeService, descendantGroupIds } from '../rbac/scope';

export const RESERVED_SLUGS = new Set(['www', 'api', 'admin', 'mqtt', 'app', 'mail']);

type CustomerRow = typeof customer.$inferSelect;
type GroupRow = typeof customerGroup.$inferSelect;

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly scopes: ScopeService,
  ) {}

  list(search?: string): Promise<CustomerRow[]> {
    const where = search ? or(ilike(customer.name, `%${search}%`), ilike(customer.slug, `%${search}%`)) : undefined;
    return this.db.select().from(customer).where(where).orderBy(asc(customer.name));
  }

  async get(id: string): Promise<CustomerRow> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.customer.findFirst({ where: eq(customer.id, id) });
    if (!row) throw notFound();
    return row;
  }

  async create(input: { name: string; slug: string; status?: 'active' | 'suspended' }): Promise<CustomerRow> {
    this.assertSlug(input.slug);
    try {
      const [row] = await this.db.insert(customer).values(input).returning();
      await this.redis.del(tenantCacheKey(input.slug));
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug already in use');
      throw err;
    }
  }

  async update(id: string, patch: { name?: string; slug?: string; status?: 'active' | 'suspended' }): Promise<CustomerRow> {
    const existing = await this.get(id);
    if (patch.slug) this.assertSlug(patch.slug);
    try {
      const [row] = await this.db.update(customer).set(patch).where(eq(customer.id, id)).returning();
      await this.redis.del(tenantCacheKey(existing.slug), ...(patch.slug ? [tenantCacheKey(patch.slug)] : []));
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug already in use');
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const existing = await this.get(id);
    const hasDevices = await this.db.query.device.findFirst({ where: eq(device.customerId, id), columns: { id: true } });
    if (hasDevices) throw conflict('Customer still has devices; reassign or delete them first');
    await this.db.delete(customer).where(eq(customer.id, id));
    await this.redis.del(tenantCacheKey(existing.slug));
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  /** Platform users may touch any customer; customer users only their own (404 otherwise). */
  async assertCustomerAccess(actor: AuthUser, customerId: string): Promise<void> {
    if (actor.scopeType === 'customer') {
      if (actor.customerId !== customerId) throw notFound();
      return;
    }
    await this.get(customerId);
  }

  async listGroups(actor: AuthUser, customerId: string): Promise<GroupRow[]> {
    await this.assertCustomerAccess(actor, customerId);
    return this.db
      .select()
      .from(customerGroup)
      .where(eq(customerGroup.customerId, customerId))
      .orderBy(asc(customerGroup.name));
  }

  async createGroup(actor: AuthUser, customerId: string, input: { name: string; parentId?: string | null }) {
    await this.assertCustomerAccess(actor, customerId);
    if (input.parentId) await this.getGroup(customerId, input.parentId);
    const [row] = await this.db
      .insert(customerGroup)
      .values({ customerId, name: input.name, parentId: input.parentId ?? null })
      .returning();
    await this.scopes.invalidate(customerId);
    return row!;
  }

  async updateGroup(
    actor: AuthUser,
    customerId: string,
    groupId: string,
    patch: { name?: string; parentId?: string | null },
  ) {
    await this.assertCustomerAccess(actor, customerId);
    await this.getGroup(customerId, groupId);
    if (patch.parentId) {
      await this.getGroup(customerId, patch.parentId);
      const all = await this.db
        .select({ id: customerGroup.id, parentId: customerGroup.parentId })
        .from(customerGroup)
        .where(eq(customerGroup.customerId, customerId));
      if (descendantGroupIds(groupId, all).includes(patch.parentId)) {
        throw validation([{ path: ['parentId'], message: 'A group cannot be moved under itself' }]);
      }
    }
    const [row] = await this.db.update(customerGroup).set(patch).where(eq(customerGroup.id, groupId)).returning();
    await this.scopes.invalidate(customerId);
    return row!;
  }

  async removeGroup(actor: AuthUser, customerId: string, groupId: string): Promise<void> {
    await this.assertCustomerAccess(actor, customerId);
    await this.getGroup(customerId, groupId);
    await this.db.delete(customerGroup).where(eq(customerGroup.id, groupId));
    await this.scopes.invalidate(customerId);
  }

  async getGroup(customerId: string, groupId: string): Promise<GroupRow> {
    if (!isUuid(groupId)) throw notFound();
    const row = await this.db.query.customerGroup.findFirst({
      where: and(eq(customerGroup.id, groupId), eq(customerGroup.customerId, customerId)),
    });
    if (!row) throw notFound();
    return row;
  }

  private assertSlug(slug: string): void {
    if (RESERVED_SLUGS.has(slug)) throw validation([{ path: ['slug'], message: 'This slug is reserved' }]);
  }
}
