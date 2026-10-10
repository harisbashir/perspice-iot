import { Inject, Injectable } from '@nestjs/common';
import { type WebhookDto, type WebhookEvent, WebhookInputSchema } from '@perspice/shared';
import { and, arrayContains, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { notFound, validation } from '../common/app-error';
import { encryptSecret, randomToken } from '../common/crypto';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { customer, webhook } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { Dispatcher } from './dispatcher';
import { UnsafeDestinationError, assertSafeUrl } from './ssrf';
import { WebhookSender } from './webhook-sender';

type Row = typeof webhook.$inferSelect;

export const PolicyBody = z.object({ allowHttp: z.boolean(), allowPrivate: z.boolean() });

const toDto = (r: Row, secret?: string): WebhookDto => ({
  id: r.id,
  customerId: r.customerId,
  name: r.name,
  url: r.url,
  events: r.events,
  enabled: r.enabled,
  createdAt: r.createdAt.getTime(),
  ...(secret ? { secret } : {}),
});

/**
 * Outbound webhooks. Customer admins manage their customer's webhooks, which only ever receive
 * that customer's events; platform webhooks (no customer) receive every customer's. Secrets are
 * encrypted at rest and shown only when created or rotated (Review Focus 3).
 */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    private readonly dispatcher: Dispatcher,
    private readonly sender: WebhookSender,
    private readonly settings: SettingsService,
  ) {}

  async list(actor: AuthUser): Promise<WebhookDto[]> {
    const rows = await this.db
      .select()
      .from(webhook)
      .where(actor.scopeType === 'customer' ? eq(webhook.customerId, actor.customerId!) : undefined)
      .orderBy(webhook.name);
    return rows.map((r) => toDto(r));
  }

  async create(actor: AuthUser, body: unknown): Promise<WebhookDto> {
    const input = WebhookInputSchema.parse(body);
    const customerId = await this.tenantFor(actor, input.customerId ?? null);
    await this.checkUrl(input.url);
    const secret = randomToken('whsec_');
    const [row] = await this.db
      .insert(webhook)
      .values({ customerId, name: input.name, url: input.url, events: input.events, enabled: input.enabled, secretEnc: encryptSecret(secret, this.config.masterKey), createdBy: actor.id })
      .returning();
    return toDto(row!, secret);
  }

  async update(actor: AuthUser, id: string, body: unknown): Promise<WebhookDto> {
    await this.find(actor, id);
    const input = WebhookInputSchema.omit({ customerId: true }).parse(body);
    await this.checkUrl(input.url);
    const [row] = await this.db
      .update(webhook)
      .set({ name: input.name, url: input.url, events: input.events, enabled: input.enabled, updatedAt: new Date() })
      .where(eq(webhook.id, id))
      .returning();
    return toDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.find(actor, id);
    await this.db.delete(webhook).where(eq(webhook.id, id));
  }

  async rotateSecret(actor: AuthUser, id: string): Promise<WebhookDto> {
    await this.find(actor, id);
    const secret = randomToken('whsec_');
    const [row] = await this.db
      .update(webhook)
      .set({ secretEnc: encryptSecret(secret, this.config.masterKey), updatedAt: new Date() })
      .where(eq(webhook.id, id))
      .returning();
    return toDto(row!, secret);
  }

  /** Sends a `ping` now and reports the outcome (not queued, not retried). */
  async test(actor: AuthUser, id: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    await this.find(actor, id);
    const body = JSON.stringify({ id: 'ping', event: 'ping', ts: Date.now(), data: { message: 'Hello from Perspice' } });
    try {
      const status = await this.sender.send(id, { deliveryId: 'ping', event: 'ping', body });
      return { ok: true, status, error: null };
    } catch (err) {
      return { ok: false, status: null, error: (err as Error).message };
    }
  }

  /** Queues an event for every enabled webhook subscribed to it within the event's tenant. */
  async emit(event: WebhookEvent, customerId: string | null, data: Record<string, unknown>): Promise<number> {
    const hooks = await this.db
      .select({ id: webhook.id, customerId: webhook.customerId, url: webhook.url })
      .from(webhook)
      .where(
        and(
          eq(webhook.enabled, true),
          arrayContains(webhook.events, [event]),
          customerId ? or(isNull(webhook.customerId), eq(webhook.customerId, customerId)) : isNull(webhook.customerId),
        ),
      );
    for (const h of hooks) {
      await this.dispatcher.enqueueWebhook(h.id, h.customerId, new URL(h.url).host, event, data);
    }
    return hooks.length;
  }

  async getPolicy() {
    return this.sender.policy();
  }

  async setPolicy(body: unknown) {
    const policy = PolicyBody.parse(body);
    await this.settings.set('webhooks.policy', policy);
    return policy;
  }

  private async tenantFor(actor: AuthUser, requested: string | null): Promise<string | null> {
    if (actor.scopeType === 'customer') {
      if (requested && requested !== actor.customerId) throw notFound();
      return actor.customerId;
    }
    if (requested && !(await this.db.query.customer.findFirst({ where: eq(customer.id, requested) }))) throw notFound();
    return requested;
  }

  private async checkUrl(url: string): Promise<void> {
    try {
      await assertSafeUrl(url, await this.sender.policy());
    } catch (err) {
      if (err instanceof UnsafeDestinationError) throw validation([{ path: ['url'], message: err.message }]);
      throw err;
    }
  }

  private async find(actor: AuthUser, id: string): Promise<Row> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.webhook.findFirst({ where: eq(webhook.id, id) });
    if (!row || (actor.scopeType === 'customer' && row.customerId !== actor.customerId)) throw notFound();
    return row;
  }
}
