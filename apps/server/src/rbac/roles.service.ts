import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { BUILT_IN_ROLES, type Permission, canGrant } from '@perspice/shared';
import { and, eq, isNull, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import { permCacheKey } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { conflict, forbidden, notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { customer, role, user } from '../db/schema';
import { seedRoles } from './seed-roles';

type RoleRow = typeof role.$inferSelect;

/** Permissions a customer-scope role may hold: the union of the built-in customer roles. */
export const CUSTOMER_ASSIGNABLE: ReadonlySet<Permission> = new Set(
  Object.values(BUILT_IN_ROLES)
    .filter((r) => r.scope === 'customer')
    .flatMap((r) => r.permissions),
);

export interface RoleInput {
  name: string;
  scope: 'platform' | 'customer';
  customerId?: string | null;
  permissions: Permission[];
}

@Injectable()
export class RolesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const rows = await seedRoles(this.db);
    await this.invalidate(...rows.map((r) => r.id));
  }

  /** Roles the caller can see: customers see customer-scope roles usable in their customer. */
  async list(actor: AuthUser): Promise<RoleRow[]> {
    if (actor.scopeType === 'platform') return this.db.select().from(role).orderBy(role.name);
    return this.db
      .select()
      .from(role)
      .where(
        and(eq(role.scope, 'customer'), or(isNull(role.customerId), eq(role.customerId, actor.customerId!))),
      )
      .orderBy(role.name);
  }

  /** A role visible to `actor`, or 404. */
  async get(actor: AuthUser, id: string): Promise<RoleRow> {
    if (!isUuid(id)) throw notFound();
    const r = await this.db.query.role.findFirst({ where: eq(role.id, id) });
    if (!r) throw notFound();
    if (actor.scopeType === 'customer') {
      // Another customer's custom role is a tenant object (404); platform roles are not secret (403).
      if (r.customerId && r.customerId !== actor.customerId) throw notFound();
      if (r.scope !== 'customer') throw forbidden('Platform roles cannot be assigned here');
    }
    return r;
  }

  async create(actor: AuthUser, input: RoleInput): Promise<RoleRow> {
    await this.validate(actor, input);
    const [r] = await this.db
      .insert(role)
      .values({
        name: input.name,
        scope: input.scope,
        customerId: input.scope === 'customer' ? (input.customerId ?? null) : null,
        permissions: input.permissions,
      })
      .returning();
    return r!;
  }

  async update(actor: AuthUser, id: string, patch: Partial<Pick<RoleInput, 'name' | 'permissions'>>): Promise<RoleRow> {
    const existing = await this.get(actor, id);
    if (existing.builtIn) throw forbidden('Built-in roles cannot be changed');
    const next = { ...existing, ...patch };
    await this.validate(actor, next);
    const [r] = await this.db
      .update(role)
      .set({ name: next.name, permissions: next.permissions })
      .where(eq(role.id, id))
      .returning();
    await this.invalidate(id);
    return r!;
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const existing = await this.get(actor, id);
    if (existing.builtIn) throw forbidden('Built-in roles cannot be deleted');
    const inUse = await this.db.query.user.findFirst({ where: eq(user.roleId, id), columns: { id: true } });
    if (inUse) throw conflict('Role is assigned to users');
    await this.db.delete(role).where(eq(role.id, id));
    await this.invalidate(id);
  }

  async invalidate(...roleIds: string[]): Promise<void> {
    if (roleIds.length) await this.redis.del(...roleIds.map(permCacheKey));
  }

  private async validate(actor: AuthUser, input: RoleInput): Promise<void> {
    if (!canGrant(actor.permissions, input.permissions)) throw forbidden('Cannot grant permissions you do not hold');
    if (input.scope === 'customer') {
      const bad = input.permissions.filter((p) => !CUSTOMER_ASSIGNABLE.has(p));
      if (bad.length) throw validation([{ path: ['permissions'], message: `Not allowed for customer roles: ${bad.join(', ')}` }]);
      if (input.customerId) {
        const c = await this.db.query.customer.findFirst({ where: eq(customer.id, input.customerId) });
        if (!c) throw notFound();
      }
    }
  }
}
