import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SQL, and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  actorType: 'user' | 'apikey' | 'system' | 'device';
  actorId: string | null;
  customerId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  diff?: unknown;
  ip?: string;
}

export interface AuditQuery {
  customerId?: string | null;
  targetType?: string;
  targetId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

type AuditRow = typeof auditLog.$inferSelect;

function encodeCursor(row: AuditRow): string {
  return Buffer.from(JSON.stringify([row.ts.toISOString(), row.id])).toString('base64url');
}

function decodeCursor(cursor: string): { ts: Date; id: string } {
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    return { ts: new Date(ts), id };
  } catch {
    throw validation([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: DB) {}

  /** Never throws: a failed audit write is logged rather than failing the user's action. */
  async record(e: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        actorType: e.actorType,
        actorId: e.actorId,
        customerId: e.customerId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        diff: e.diff ?? null,
        ip: e.ip,
      });
    } catch (err) {
      this.logger.error(`Failed to record audit ${e.action}: ${(err as Error).message}`);
    }
  }

  /** Newest first; `customerId` undefined = all customers (platform), null = platform-only rows. */
  async list(q: AuditQuery): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
    const conds: SQL[] = [];
    if (q.customerId !== undefined && q.customerId !== null) conds.push(eq(auditLog.customerId, q.customerId));
    if (q.targetType) conds.push(eq(auditLog.targetType, q.targetType));
    if (q.targetId) conds.push(eq(auditLog.targetId, q.targetId));
    if (q.actorId) conds.push(eq(auditLog.actorId, q.actorId));
    if (q.from) conds.push(gte(auditLog.ts, q.from));
    if (q.to) conds.push(lte(auditLog.ts, q.to));
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      conds.push(or(lt(auditLog.ts, c.ts), and(eq(auditLog.ts, c.ts), lt(auditLog.id, c.id)))!);
    }
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...conds))
      .orderBy(desc(auditLog.ts), desc(auditLog.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? encodeCursor(items[items.length - 1]!) : null };
  }
}
