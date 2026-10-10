import { eq } from 'drizzle-orm';
import { notFound } from '../common/app-error';
import { type Scope, type ScopedTable, scoped } from '../rbac/scope';
import type { DB } from './db.module';

export { scoped };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads one row visible in `scope`; anything else (missing, other tenant, malformed id) is 404. */
export async function findOneOr404<T extends ScopedTable>(
  db: DB,
  table: T,
  id: string,
  scope: Scope,
): Promise<T['$inferSelect']> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await db
    .select()
    .from(table as ScopedTable)
    .where(scoped(table, scope, eq(table.id, id)))
    .limit(1);
  if (!row) throw notFound();
  return row as T['$inferSelect'];
}

export const isUuid = (id: string) => UUID.test(id);
