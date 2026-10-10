import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type Redis from 'ioredis';
import { notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { notification } from '../db/schema';

type NotificationRow = typeof notification.$inferSelect;

export interface NotificationDto {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface NewNotification {
  type: string;
  severity: NotificationDto['severity'];
  title: string;
  body: string;
  link?: string;
}

const toDto = (n: NotificationRow): NotificationDto => ({
  id: n.id,
  type: n.type,
  severity: n.severity,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.getTime() ?? null,
  createdAt: n.createdAt.getTime(),
});

const encodeCursor = (n: NotificationRow) => Buffer.from(JSON.stringify([n.createdAt.toISOString(), n.id])).toString('base64url');
function decodeCursor(c: string): [Date, string] {
  try {
    const [ts, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
    return [new Date(ts), id];
  } catch {
    throw validation([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Stores an in-app notification and pushes it to the user's open sessions. */
  async create(userId: string, n: NewNotification): Promise<NotificationDto> {
    const [row] = await this.db
      .insert(notification)
      .values({ userId, ...n, createdAt: new Date() })
      .returning();
    const dto = toDto(row!);
    await this.redis.publish(`ws:notify:${userId}`, JSON.stringify(dto));
    return dto;
  }

  async list(userId: string, q: { unread?: boolean; cursor?: string; limit: number }) {
    const conds = [eq(notification.userId, userId)];
    if (q.unread) conds.push(isNull(notification.readAt));
    if (q.cursor) {
      const [ts, id] = decodeCursor(q.cursor);
      conds.push(or(lt(notification.createdAt, ts), and(eq(notification.createdAt, ts), lt(notification.id, id)))!);
    }
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(...conds))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return { items: page.map(toDto), nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null };
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notification)
      .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    return row?.n ?? 0;
  }

  async markRead(userId: string, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.id, id), eq(notification.userId, userId)))
      .returning({ id: notification.id });
    if (!row) throw notFound();
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  }
}
