import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import { DB } from '../db/db.module';
import { deliveryLog } from '../db/schema';
import { JobRegistry } from '../scheduler/job-registry';
import { type DeliveryPayload, Dispatcher, isQuiet } from './dispatcher';
import { PreferencesService } from './preferences.service';

const LISTED = 50;

/**
 * Every minute (scheduler role): releases held email/push notifications as one digest per user,
 * once the user is out of quiet hours and the busy period that held them has passed (Review
 * Focus 4). Users with email off get a single summary push instead.
 */
@Injectable()
export class DigestJob implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly dispatcher: Dispatcher,
    private readonly prefs: PreferencesService,
    private readonly auth: AuthService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_DELIVERY_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('notification-digest', 60_000, () => this.run().then(() => undefined));
  }

  /** Returns the number of digests sent. */
  async run(now = Date.now()): Promise<number> {
    const users = await this.db.selectDistinct({ userId: deliveryLog.userId }).from(deliveryLog).where(eq(deliveryLog.status, 'held'));
    let sent = 0;
    for (const { userId } of users) {
      if (userId && (await this.release(userId, now))) sent++;
    }
    return sent;
  }

  private async release(userId: string, now: number): Promise<boolean> {
    const held = await this.db
      .select()
      .from(deliveryLog)
      .where(and(eq(deliveryLog.userId, userId), eq(deliveryLog.status, 'held')))
      .orderBy(asc(deliveryLog.createdAt));
    if (!held.length) return false;
    const p = await this.prefs.get(userId);
    const { recipient } = held[0]!.payload as unknown as DeliveryPayload;
    if (isQuiet(p, 'info', now, recipient.timezone)) return false;
    // Held for a busy period: wait until it has passed. Held for quiet hours: they just ended.
    const busy = now - held[held.length - 1]!.createdAt.getTime() < p.digest.windowMin * 60_000;
    if (busy && !isQuiet(p, 'info', held[0]!.createdAt.getTime(), recipient.timezone)) return false;

    // One entry per message (a message held for both email and push appears once).
    const messages = new Map<string, DeliveryPayload['message']>();
    for (const h of held) {
      const m = (h.payload as unknown as DeliveryPayload).message;
      messages.set(`${m.type}|${m.title}|${m.body}|${m.link}`, m);
    }
    const list = [...messages.values()];
    const base = this.auth.publicUrlFor(recipient.scopeType === 'customer' ? recipient.customerSlug : null);
    const title = `${list.length} notification${list.length === 1 ? '' : 's'}`;
    const digest = {
      type: 'digest',
      level: 'info' as const,
      title,
      body: list.slice(0, 3).map((m) => m.title).join('; ') + (list.length > 3 ? '; …' : ''),
      link: '/',
      customerId: recipient.customerId,
      email: {
        template: 'digest' as const,
        vars: {
          count: list.length,
          reason: 'while notifications were paused (quiet hours or a busy period)',
          items: list.slice(0, LISTED).map((m) => ({ title: m.title, body: m.body, url: m.link ? base + m.link : null })),
          more: Math.max(0, list.length - LISTED),
        },
      },
    };
    await this.db
      .update(deliveryLog)
      .set({ status: 'sent', error: 'Included in a digest', updatedAt: new Date() })
      .where(inArray(deliveryLog.id, held.map((h) => h.id)));
    if (p.email) await this.dispatcher.enqueue('email', recipient, digest);
    else if (p.push) await this.dispatcher.enqueue('push', recipient, digest);
    return true;
  }
}
