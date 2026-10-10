import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, eq, inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { customerGroup } from '../db/schema';

export type Scope = { kind: 'platform' } | { kind: 'customer'; customerId: string; groupIds: string[] | null };

interface GroupNode {
  id: string;
  parentId: string | null;
}

export function descendantGroupIds(rootId: string, groups: GroupNode[]): string[] {
  const children = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parentId) continue;
    children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
  }
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...seen];
}

/** `groups` = the customer's groups (only needed when the user is narrowed to a group). */
export function scopeOf(user: AuthUser, groups: GroupNode[] = []): Scope {
  if (user.scopeType === 'platform') return { kind: 'platform' };
  return {
    kind: 'customer',
    customerId: user.customerId!,
    groupIds: user.groupId ? descendantGroupIds(user.groupId, groups) : null,
  };
}

const GROUP_CACHE_TTL_S = 60;
export const groupsCacheKey = (customerId: string) => `groups:${customerId}`;

@Injectable()
export class ScopeService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async forUser(user: AuthUser): Promise<Scope> {
    if (user.scopeType === 'platform' || !user.groupId) return scopeOf(user);
    return scopeOf(user, await this.groups(user.customerId!));
  }

  async invalidate(customerId: string): Promise<void> {
    await this.redis.del(groupsCacheKey(customerId));
  }

  private async groups(customerId: string): Promise<GroupNode[]> {
    const cached = await this.redis.get(groupsCacheKey(customerId));
    if (cached) return JSON.parse(cached) as GroupNode[];
    const rows = await this.db
      .select({ id: customerGroup.id, parentId: customerGroup.parentId })
      .from(customerGroup)
      .where(eq(customerGroup.customerId, customerId));
    await this.redis.set(groupsCacheKey(customerId), JSON.stringify(rows), 'EX', GROUP_CACHE_TTL_S);
    return rows;
  }
}

/** A tenant table: has `customer_id`, optionally `group_id`. */
export type ScopedTable = PgTable & { id: PgColumn; customerId: PgColumn; groupId?: PgColumn };

/**
 * The tenant condition for `table` under `scope`, AND-ed with `extra`. Every customer-owned
 * query goes through this (or `findOneOr404`) — handlers never build unscoped tenant queries.
 */
export function scoped(table: ScopedTable, scope: Scope, ...extra: (SQL | undefined)[]): SQL | undefined {
  const conds = extra.filter((c): c is SQL => c !== undefined);
  if (scope.kind === 'customer') {
    conds.push(eq(table.customerId, scope.customerId));
    if (scope.groupIds && table.groupId) conds.push(inArray(table.groupId, scope.groupIds));
  }
  return conds.length ? and(...conds) : undefined;
}
