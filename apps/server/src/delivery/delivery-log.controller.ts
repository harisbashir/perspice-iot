import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { type DeliveryDto, NOTIFY_CHANNELS } from '@perspice/shared';
import { type SQL, and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { conflict, notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { deliveryLog } from '../db/schema';
import { Require } from '../rbac/require.decorator';
import { Dispatcher } from './dispatcher';

const STATUSES = ['queued', 'sent', 'failed', 'dead', 'held'] as const;
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item).optional());
const ListQuery = z.object({
  channel: csv(z.enum(NOTIFY_CHANNELS)),
  status: csv(z.enum(STATUSES)),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

type Row = typeof deliveryLog.$inferSelect;
const toDto = (r: Row): DeliveryDto => ({
  id: r.id,
  channel: r.channel,
  recipient: r.recipient,
  subject: r.subject,
  status: r.status,
  attempts: r.attempts,
  error: r.error,
  createdAt: r.createdAt.getTime(),
  updatedAt: r.updatedAt.getTime(),
});
const encode = (r: Row) => Buffer.from(JSON.stringify([r.createdAt.toISOString(), r.id])).toString('base64url');
function decode(c: string): [Date, string] {
  try {
    const [ts, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
    return [new Date(ts), id];
  } catch {
    throw validation([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

/** The admin delivery log (spec §6.2): every notification and webhook call, and dead letters to retry. */
@Controller('delivery-log')
export class DeliveryLogController {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly dispatcher: Dispatcher,
  ) {}

  /** Customer users see their own customer's deliveries only. */
  private scope(actor: AuthUser): SQL | undefined {
    return actor.scopeType === 'customer' ? eq(deliveryLog.customerId, actor.customerId!) : undefined;
  }

  @Get()
  @Require('audit.read')
  async list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    const q = ListQuery.parse(raw);
    const conds: (SQL | undefined)[] = [
      this.scope(actor),
      q.channel?.length ? inArray(deliveryLog.channel, q.channel) : undefined,
      q.status?.length ? inArray(deliveryLog.status, q.status) : undefined,
    ];
    if (q.cursor) {
      const [ts, id] = decode(q.cursor);
      conds.push(or(lt(deliveryLog.createdAt, ts), and(eq(deliveryLog.createdAt, ts), lt(deliveryLog.id, id))));
    }
    const rows = await this.db
      .select()
      .from(deliveryLog)
      .where(and(...conds))
      .orderBy(desc(deliveryLog.createdAt), desc(deliveryLog.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return { items: page.map(toDto), nextCursor: rows.length > q.limit ? encode(page[page.length - 1]!) : null };
  }

  /** Queues a failed or dead delivery again (with a fresh set of attempts). */
  @Post(':id/retry')
  @Require('webhook.manage')
  @HttpCode(202)
  @Audited('delivery.retry', 'delivery', { targetIdFrom: 'param' })
  async retry(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(deliveryLog)
      .where(and(eq(deliveryLog.id, id), this.scope(actor)))
      .limit(1);
    if (!row) throw notFound();
    if (row.status !== 'failed' && row.status !== 'dead') throw conflict('Only failed deliveries can be retried');
    const [updated] = await this.db
      .update(deliveryLog)
      .set({ status: 'queued', attempts: 0, error: null, updatedAt: new Date() })
      .where(eq(deliveryLog.id, id))
      .returning();
    await this.dispatcher.requeue(id);
    return toDto(updated!);
  }
}
