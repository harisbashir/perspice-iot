import { BUILT_IN_ROLES, BUILT_IN_ROLE_KEYS, type BuiltInRoleKey } from '@perspice/shared';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/db.module';
import { role } from '../db/schema';

export const BUILT_IN_ROLE_NAMES: Record<BuiltInRoleKey, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Admin',
  support: 'Support',
  customer_admin: 'Customer Admin',
  customer_operator: 'Customer Operator',
  customer_viewer: 'Customer Viewer',
};

/** Idempotently upserts the built-in roles so their permissions always match the code. */
export async function seedRoles(db: DB): Promise<{ id: string; key: string | null }[]> {
  return db
    .insert(role)
    .values(
      BUILT_IN_ROLE_KEYS.map((key) => ({
        key,
        name: BUILT_IN_ROLE_NAMES[key],
        scope: BUILT_IN_ROLES[key].scope,
        permissions: BUILT_IN_ROLES[key].permissions,
        builtIn: true,
      })),
    )
    .onConflictDoUpdate({
      target: role.key,
      set: {
        name: sql`excluded.name`,
        scope: sql`excluded.scope`,
        permissions: sql`excluded.permissions`,
        builtIn: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: role.id, key: role.key });
}
