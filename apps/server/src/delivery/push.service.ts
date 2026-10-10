import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import webpush, { type WebPushError } from 'web-push';
import { z } from 'zod';
import { validation } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { pushSubscription } from '../db/schema';

export const SubscriptionBody = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Invalid endpoint'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export interface PushPayload {
  title: string;
  body: string;
  url: string | null;
  severity: string;
  tag?: string;
}

/** Web push with VAPID (spec §6.2). Disabled when VAPID keys are not configured. */
@Injectable()
export class PushService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
  ) {}

  get enabled(): boolean {
    return !!(this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY);
  }

  publicKey(): string | null {
    return this.enabled ? this.config.VAPID_PUBLIC_KEY! : null;
  }

  /** Stores (or moves to this user) a browser's subscription. */
  async subscribe(userId: string, body: unknown, userAgent?: string): Promise<void> {
    if (!this.enabled) throw validation([], 'Push notifications are not configured on this server');
    const s = SubscriptionBody.parse(body);
    await this.db
      .insert(pushSubscription)
      .values({ userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 300) })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 300), updatedAt: new Date() },
      });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.delete(pushSubscription).where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
  }

  async count(userId: string): Promise<number> {
    return (await this.db.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.userId, userId))).length;
  }

  /**
   * Sends to every browser the user subscribed. Gone subscriptions (404/410) are removed; other
   * failures are thrown so the delivery is retried. Returns how many browsers accepted it.
   */
  async send(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) throw new Error('Push notifications are not configured');
    const subs = await this.db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
    let ok = 0;
    const errors: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          vapidDetails: { subject: this.config.VAPID_SUBJECT || this.config.PUBLIC_URL, publicKey: this.config.VAPID_PUBLIC_KEY!, privateKey: this.config.VAPID_PRIVATE_KEY! },
          TTL: 24 * 3600,
          urgency: payload.severity === 'critical' ? 'high' : 'normal',
          timeout: 10_000,
        });
        ok++;
      } catch (err) {
        const status = (err as WebPushError).statusCode;
        if (status === 404 || status === 410) await this.db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
        else errors.push(`${status ?? ''} ${(err as Error).message}`.trim());
      }
    }
    if (errors.length && !ok) throw new Error(`Push failed: ${errors.join('; ')}`);
    return ok;
  }
}
