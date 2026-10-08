import { BUILT_IN_ROLES, type BuiltInRoleKey } from '@perspice/shared';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../src/db/db.module';
import { customer, device, deviceProfile, role, user } from '../src/db/schema';

const suffix = () => randomBytes(4).toString('hex');

export async function createCustomer(db: DB, overrides: Partial<typeof customer.$inferInsert> = {}) {
  const s = suffix();
  const [row] = await db
    .insert(customer)
    .values({ name: `Customer ${s}`, slug: `cust-${s}`, ...overrides })
    .returning();
  return row!;
}

export async function ensureRole(db: DB, key: BuiltInRoleKey) {
  const existing = await db.query.role.findFirst({ where: eq(role.key, key) });
  if (existing) return existing;
  const def = BUILT_IN_ROLES[key];
  const [row] = await db
    .insert(role)
    .values({ key, name: key, scope: def.scope, permissions: def.permissions, builtIn: true })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db.query.role.findFirst({ where: eq(role.key, key) }))!;
}

export interface CreateUserOptions {
  roleKey: BuiltInRoleKey;
  customerId?: string | null;
  groupId?: string | null;
  email?: string;
  name?: string;
  password?: string;
  status?: 'invited' | 'active' | 'disabled';
}

export async function createUser(db: DB, opts: CreateUserOptions) {
  const r = await ensureRole(db, opts.roleKey);
  const password = opts.password ?? 'correct-horse-battery';
  const [row] = await db
    .insert(user)
    .values({
      email: (opts.email ?? `user-${suffix()}@example.com`).toLowerCase(),
      name: opts.name ?? 'Test User',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      scopeType: r.scope,
      customerId: opts.customerId ?? null,
      groupId: opts.groupId ?? null,
      roleId: r.id,
      status: opts.status ?? 'active',
    })
    .returning();
  return { ...row!, password };
}

export async function createProfile(db: DB, overrides: Partial<typeof deviceProfile.$inferInsert> = {}) {
  const [row] = await db
    .insert(deviceProfile)
    .values({ name: `Profile ${suffix()}`, ...overrides })
    .returning();
  return row!;
}

export interface CreateDeviceOptions extends Partial<typeof device.$inferInsert> {
  profileId: string;
}

export async function createDevice(db: DB, opts: CreateDeviceOptions) {
  const token = `pdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(device)
    .values({
      name: `Device ${suffix()}`,
      credentialsHash: createHash('sha256').update(token).digest('hex'),
      ...opts,
    })
    .returning();
  return { device: row!, token };
}
