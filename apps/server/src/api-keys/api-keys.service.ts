import { Inject, Injectable } from '@nestjs/common';
import { type Permission, canGrant } from '@perspice/shared';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound, validation } from '../common/app-error';
import { randomToken, sha256Hex } from '../common/crypto';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { apiKey, user } from '../db/schema';

type ApiKeyRow = typeof apiKey.$inferSelect;

const toDto = (k: ApiKeyRow) => ({
  id: k.id,
  name: k.name,
  permissions: k.permissions,
  scopeType: k.scopeType,
  customerId: k.customerId,
  expiresAt: k.expiresAt?.getTime() ?? null,
  lastUsed: k.lastUsed?.getTime() ?? null,
  createdAt: k.createdAt.getTime(),
});

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DB) private readonly db: DB) {}

  async list(actor: AuthUser) {
    const rows = await this.db
      .select()
      .from(apiKey)
      .where(eq(apiKey.createdBy, actor.id))
      .orderBy(desc(apiKey.createdAt));
    return rows.map(toDto);
  }

  /** Every key in the actor's scope, with its creator: for admins revoking a leaver's or leaked key. */
  async listOrganisation(actor: AuthUser) {
    if (!actor.permissions.includes('user.manage')) throw forbidden('Missing permission');
    const rows = await this.db
      .select({ key: apiKey, creator: { id: user.id, name: user.name, email: user.email } })
      .from(apiKey)
      .innerJoin(user, eq(user.id, apiKey.createdBy))
      .where(this.inScope(actor))
      .orderBy(desc(apiKey.createdAt));
    return rows.map((r) => ({ ...toDto(r.key), createdBy: r.creator }));
  }

  /** Platform admins: every key; customer admins: their customer's. */
  private inScope(actor: AuthUser): SQL | undefined {
    return actor.scopeType === 'platform' ? undefined : eq(apiKey.customerId, actor.customerId!);
  }

  /** Keys inherit the creator's scope and may only carry permissions the creator holds. */
  async create(actor: AuthUser, input: { name: string; permissions: Permission[]; expiresAt?: number }) {
    if (actor.kind !== 'user') throw forbidden('API keys cannot create API keys');
    if (!canGrant(actor.permissions, input.permissions)) throw forbidden('Cannot grant permissions you do not hold');
    if (input.expiresAt !== undefined && input.expiresAt <= Date.now()) {
      throw validation([{ path: ['expiresAt'], message: 'Must be in the future' }]);
    }
    const key = randomToken('pk_');
    const [row] = await this.db
      .insert(apiKey)
      .values({
        name: input.name,
        keyHash: sha256Hex(key),
        createdBy: actor.id,
        scopeType: actor.scopeType,
        customerId: actor.customerId,
        groupId: actor.groupId,
        permissions: [...new Set(input.permissions)],
        expiresAt: input.expiresAt !== undefined ? new Date(input.expiresAt) : null,
      })
      .returning();
    return { ...toDto(row!), key };
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    // Your own keys, or (with user.manage) any key in your scope.
    const mine = eq(apiKey.createdBy, actor.id);
    const where = actor.permissions.includes('user.manage') ? and(eq(apiKey.id, id), this.inScope(actor)) : and(eq(apiKey.id, id), mine);
    const [row] = await this.db.delete(apiKey).where(where).returning({ id: apiKey.id });
    if (!row) throw notFound();
  }
}
