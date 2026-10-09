import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { decryptSecret } from '../common/crypto';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { webhook } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { type DestinationPolicy, assertSafeUrl, guardedLookup } from './ssrf';

const TIMEOUT_MS = 5000;

/** `sha256=<hex>` over `<timestamp>.<body>` with the webhook's secret. */
export function signature(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export interface WebhookCall {
  deliveryId: string;
  event: string;
  body: string;
}

/**
 * Posts signed webhook calls (Review Focus 3): https only unless allowed, the destination address
 * is checked when connecting (not just when saved), redirects are not followed, 5 s timeout.
 */
@Injectable()
export class WebhookSender {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    private readonly settings: SettingsService,
  ) {}

  async policy(): Promise<DestinationPolicy> {
    return (await this.settings.get('webhooks.policy')) ?? { allowHttp: false, allowPrivate: false };
  }

  /** Sends to a stored webhook; resolves with the HTTP status (2xx), rejects otherwise. */
  async send(webhookId: string, call: WebhookCall): Promise<number> {
    const hook = await this.db.query.webhook.findFirst({ where: eq(webhook.id, webhookId) });
    if (!hook) throw new Error('Webhook was deleted');
    if (!hook.enabled) throw new Error('Webhook is disabled');
    return this.post(hook.url, decryptSecret(hook.secretEnc, this.config.masterKey), call);
  }

  async post(rawUrl: string, secret: string, call: WebhookCall): Promise<number> {
    const policy = await this.policy();
    const url = await assertSafeUrl(rawUrl, policy);
    const ts = Math.floor(Date.now() / 1000);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<number>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          lookup: guardedLookup(policy) as never,
          timeout: TIMEOUT_MS,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Perspice-Webhook/1',
            'x-perspice-event': call.event,
            'x-perspice-delivery': call.deliveryId,
            'x-perspice-timestamp': String(ts),
            'x-perspice-signature': signature(secret, ts, call.body),
          },
        },
        (res) => {
          res.resume(); // the body is not used
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve(status);
          else if (status >= 300 && status < 400) reject(new Error(`HTTP ${status}: redirects are not followed`));
          else reject(new Error(`HTTP ${status}`));
        },
      );
      req.on('timeout', () => req.destroy(new Error(`No response within ${TIMEOUT_MS / 1000} s`)));
      req.on('error', reject);
      req.end(call.body);
    });
  }
}
