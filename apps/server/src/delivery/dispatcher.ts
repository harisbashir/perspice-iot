import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type NotificationPreferences, type NotifyChannel, notifyLevelAtLeast } from '@perspice/shared';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { REDIS } from '../common/redis.module';
import { inSchedule } from '../alarms/evaluator';
import { AuthService } from '../auth/auth.service';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { deliveryLog } from '../db/schema';
import { PreferencesService } from './preferences.service';
import { WebhookSender } from './webhook-sender';
import { PushService } from './push.service';
import { CHANNELS, type Message, type NotificationChannel, type Recipient } from './types';

export const NOTIFY_QUEUE = 'notify';
export const MAX_ATTEMPTS = 5;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Quiet hours apply to email and push; critical messages may bypass them. */
export function isQuiet(p: NotificationPreferences, level: Message['level'], ts: number, tz: string): boolean {
  if (!p.quietHours) return false;
  if (level === 'critical' && p.criticalBypassesQuietHours) return false;
  return inSchedule({ days: ALL_DAYS, ...p.quietHours }, ts, tz);
}

export interface WebhookPayload {
  [k: string]: unknown;
  event: string;
  /** The exact JSON that is signed and sent (stable across retries). */
  body: string;
}

export interface DeliveryPayload {
  message: Message;
  recipient: Recipient;
}

/**
 * Fans a message out to users and channels (spec §6.2). In-app notifications are always stored;
 * email and push follow each user's preferences (channel, minimum level, quiet hours). Every send
 * is a `delivery_log` row and a BullMQ job with 5 attempts and exponential back-off.
 */
@Injectable()
export class Dispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(Dispatcher.name);
  readonly queue: Queue<{ deliveryId: string }>;
  private readonly connection: Redis;
  private readonly channels: Map<NotifyChannel, NotificationChannel>;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CHANNELS) channels: NotificationChannel[],
    private readonly prefs: PreferencesService,
    private readonly auth: AuthService,
    private readonly webhooks: WebhookSender,
    private readonly push: PushService,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(NOTIFY_QUEUE, { connection: this.connection });
    this.channels = new Map(channels.map((c) => [c.name, c]));
  }

  /** Returns the number of deliveries queued (held ones excluded). */
  async dispatch(recipients: Recipient[], message: Message, channels: NotifyChannel[], now = Date.now(), opts: { ignoreLevelAndQuiet?: boolean } = {}): Promise<number> {
    let queued = 0;
    for (const r of recipients) {
      const p = await this.prefs.get(r.id);
      const pushOn = channels.includes('push') && (await this.push.isEnabled());
      const outward = channels.filter((c) => c !== 'inapp' && c !== 'webhook' && this.channels.has(c) && p[c as 'email' | 'push'] && (c !== 'push' || pushOn));
      const wanted = opts.ignoreLevelAndQuiet || notifyLevelAtLeast(message.level, p.minSeverity);
      // Email/push are held (for a digest) during quiet hours or once the user's busy-period limit is hit.
      const hold = !opts.ignoreLevelAndQuiet && wanted && outward.length > 0 && (isQuiet(p, message.level, now, r.timezone) || (await this.overLimit(r.id, p, now)));
      for (const channel of channels) {
        if (channel === 'webhook' || !this.channels.has(channel)) continue;
        if (channel !== 'inapp' && (!outward.includes(channel) || !wanted)) continue;
        if (channel !== 'inapp' && hold) {
          await this.log(channel, r, message, 'held');
          continue;
        }
        await this.enqueue(channel, r, message);
        queued++;
      }
    }
    return queued;
  }

  /** Queues one delivery, bypassing preferences (used for digests). */
  async enqueue(channel: NotifyChannel, r: Recipient, message: Message): Promise<string> {
    const id = await this.log(channel, r, message, 'queued');
    await this.queue.add('deliver', { deliveryId: id }, { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
    return id;
  }

  /** Puts an existing delivery back on the queue (admin retry). */
  async requeue(deliveryId: string): Promise<void> {
    await this.queue.add('deliver', { deliveryId }, { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  /** Queues one webhook call (signed JSON `{id, event, ts, data}`). */
  async enqueueWebhook(webhookId: string, customerId: string | null, host: string, event: string, data: Record<string, unknown>): Promise<string> {
    const [row] = await this.db
      .insert(deliveryLog)
      .values({ channel: 'webhook', webhookId, customerId, recipient: host, subject: event, payload: {}, status: 'queued' })
      .returning({ id: deliveryLog.id });
    const body = JSON.stringify({ id: row!.id, event, ts: Date.now(), data });
    await this.db.update(deliveryLog).set({ payload: { event, body } satisfies WebhookPayload }).where(eq(deliveryLog.id, row!.id));
    await this.queue.add('deliver', { deliveryId: row!.id }, { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
    return row!.id;
  }

  /** Counts this message in the user's window; true once more than `threshold` fall within it. */
  private async overLimit(userId: string, p: NotificationPreferences, now: number): Promise<boolean> {
    const key = `notify:rate:${userId}`;
    const windowMs = p.digest.windowMin * 60_000;
    const [, , [, n]] = (await this.redis
      .multi()
      .zremrangebyscore(key, 0, now - windowMs)
      .zadd(key, now, `${now}:${Math.random()}`)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec()) as [unknown, unknown, [unknown, number], unknown];
    return n > p.digest.threshold;
  }

  /** Sends one delivery. Failures are recorded and rethrown so the queue retries; the last becomes `dead`. */
  async run(deliveryId: string): Promise<void> {
    const row = await this.db.query.deliveryLog.findFirst({ where: eq(deliveryLog.id, deliveryId) });
    if (!row || row.status === 'sent' || row.status === 'dead') return;
    try {
      if (row.webhookId) {
        const { event, body } = row.payload as unknown as WebhookPayload;
        await this.webhooks.send(row.webhookId, { deliveryId: row.id, event, body });
      } else {
        const channel = this.channels.get(row.channel);
        const { message, recipient } = row.payload as unknown as DeliveryPayload;
        if (!channel) throw new Error(`Channel ${row.channel} is not available`);
        const base = this.auth.publicUrlFor(recipient.scopeType === 'customer' ? recipient.customerSlug : null);
        await channel.send({ id: row.id, recipient, message, url: message.link ? base + message.link : null });
      }
      await this.db.update(deliveryLog).set({ status: 'sent', attempts: row.attempts + 1, error: null, updatedAt: new Date() }).where(eq(deliveryLog.id, row.id));
    } catch (err) {
      const attempts = row.attempts + 1;
      const error = (err as Error).message;
      await this.db
        .update(deliveryLog)
        .set({ status: attempts >= MAX_ATTEMPTS ? 'dead' : 'failed', attempts, error, updatedAt: new Date() })
        .where(eq(deliveryLog.id, row.id));
      this.logger.warn(`Delivery ${row.id} (${row.channel} to ${row.recipient}) failed (attempt ${attempts}): ${error}`);
      throw err;
    }
  }

  private async log(channel: NotifyChannel, r: Recipient, message: Message, status: 'queued' | 'held'): Promise<string> {
    const payload: DeliveryPayload = { message, recipient: r };
    const [row] = await this.db
      .insert(deliveryLog)
      .values({
        channel,
        userId: r.id,
        customerId: message.customerId,
        recipient: channel === 'email' ? r.email : r.name,
        subject: message.title,
        payload: payload as unknown as Record<string, unknown>,
        status,
      })
      .returning({ id: deliveryLog.id });
    return row!.id;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
