import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { generateKeyPairSync } from 'node:crypto';
import webpush, { type WebPushError } from 'web-push';
import { z } from 'zod';
import { conflict, validation } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { pushSubscription } from '../db/schema';
import { SettingsService } from '../settings/settings.service';

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

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A new VAPID key pair (P-256): the public key as browsers want it (uncompressed point, base64url). */
export function newVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d! };
}

const KEYS_CACHE_MS = 30_000;

/**
 * Web push with VAPID (spec §6.2). The keys come from the server configuration (VAPID_* in .env)
 * or, when set up from the System page, from the settings; push is off without either.
 */
@Injectable()
export class PushService {
  private cached: { at: number; keys: VapidKeys | null } | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    private readonly settings: SettingsService,
  ) {}

  async keys(): Promise<VapidKeys | null> {
    if (this.config.VAPID_PUBLIC_KEY && this.config.VAPID_PRIVATE_KEY) {
      return { publicKey: this.config.VAPID_PUBLIC_KEY, privateKey: this.config.VAPID_PRIVATE_KEY };
    }
    if (this.cached && Date.now() - this.cached.at < KEYS_CACHE_MS) return this.cached.keys;
    const keys = (await this.settings.get('push.vapid')) ?? null;
    this.cached = { at: Date.now(), keys };
    return keys;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.keys()) !== null;
  }

  async publicKey(): Promise<string | null> {
    return (await this.keys())?.publicKey ?? null;
  }

  /** Creates the keys (stored encrypted). Once only: new keys would cut off every subscribed browser. */
  async setUp(): Promise<{ publicKey: string }> {
    if (await this.keys()) throw conflict('Push notifications are already set up');
    const keys = newVapidKeys();
    await this.settings.set('push.vapid', keys, { secret: true });
    this.cached = { at: Date.now(), keys };
    return { publicKey: keys.publicKey };
  }

  /** Stores (or moves to this user) a browser's subscription. */
  async subscribe(userId: string, body: unknown, userAgent?: string): Promise<void> {
    if (!(await this.isEnabled())) throw validation([], 'Push notifications are not configured on this server');
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
    const keys = await this.keys();
    if (!keys) throw new Error('Push notifications are not configured');
    const subs = await this.db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
    let ok = 0;
    const errors: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          vapidDetails: { subject: this.config.VAPID_SUBJECT || this.config.PUBLIC_URL, publicKey: keys.publicKey, privateKey: keys.privateKey },
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
