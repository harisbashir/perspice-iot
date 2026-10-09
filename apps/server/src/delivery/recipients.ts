import { Inject, Injectable } from '@nestjs/common';
import type { BuiltInRoleKey, Recipients } from '@perspice/shared';
import { type SQL, and, eq, inArray, or } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { customer, customerGroup, role, user } from '../db/schema';
import { descendantGroupIds } from '../rbac/scope';
import type { Recipient } from './types';

const PLATFORM_ROLES: BuiltInRoleKey[] = ['super_admin', 'platform_admin', 'support'];

/**
 * Turns a recipient spec into active users who can see the device: its customer's users (group-
 * limited users only when the device is in their groups) and platform users. Anyone else named in
 * a hand-edited spec is dropped (Review Focus 2).
 */
@Injectable()
export class RecipientResolver {
  constructor(@Inject(DB) private readonly db: DB) {}

  async resolve(spec: Recipients, d: { customerId: string | null; groupId: string | null }): Promise<Recipient[]> {
    // `platform_admin` also means super admins (as for status notifications).
    const roles = new Set<BuiltInRoleKey>(spec.roles);
    if (roles.has('platform_admin')) roles.add('super_admin');
    const platformRoles = [...roles].filter((r) => PLATFORM_ROLES.includes(r));
    const customerRoles = [...roles].filter((r) => !PLATFORM_ROLES.includes(r));

    const who: (SQL | undefined)[] = [
      platformRoles.length ? and(eq(user.scopeType, 'platform'), inArray(role.key, platformRoles)) : undefined,
      d.customerId && customerRoles.length ? and(eq(user.customerId, d.customerId), inArray(role.key, customerRoles)) : undefined,
      spec.userIds.length ? inArray(user.id, spec.userIds) : undefined,
      d.customerId && spec.groupIds.length ? and(eq(user.customerId, d.customerId), inArray(user.groupId, spec.groupIds)) : undefined,
    ];
    if (!who.some(Boolean)) return [];
    const rows = await this.db
      .select({ u: user, slug: customer.slug, customerTz: customer.timezone })
      .from(user)
      .innerJoin(role, eq(role.id, user.roleId))
      .leftJoin(customer, eq(customer.id, user.customerId))
      .where(and(eq(user.status, 'active'), or(...who)));

    // Tenant check, and group-limited users only for devices in their groups.
    const groups = d.customerId && rows.some((r) => r.u.groupId)
      ? await this.db.select({ id: customerGroup.id, parentId: customerGroup.parentId }).from(customerGroup).where(eq(customerGroup.customerId, d.customerId))
      : [];
    const seen = new Set<string>();
    const out: Recipient[] = [];
    for (const { u, slug, customerTz } of rows) {
      if (seen.has(u.id)) continue;
      if (u.scopeType === 'customer') {
        if (!d.customerId || u.customerId !== d.customerId) continue;
        if (u.groupId && !(d.groupId && descendantGroupIds(u.groupId, groups).includes(d.groupId))) continue;
      }
      seen.add(u.id);
      out.push({
        id: u.id,
        email: u.email,
        name: u.name,
        scopeType: u.scopeType,
        customerId: u.customerId,
        customerSlug: slug,
        timezone: u.timezone ?? customerTz ?? 'UTC',
      });
    }
    return out;
  }
}
