import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { and, eq, isNull } from 'drizzle-orm';
import { validation } from '../common/app-error';
import { BrandingService } from '../branding/branding.service';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { emailTemplate } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import type { EmailDriver } from './drivers/email.driver';
import { SesDriver } from './drivers/ses.driver';
import { SmtpDriver } from './drivers/smtp.driver';
import { type TemplateOverride, renderTemplate } from './template.renderer';
import type { EmailTemplateKey } from './templates';

export const EMAIL_QUEUE = 'email';

export interface EmailJob {
  templateKey: EmailTemplateKey;
  to: string;
  vars: Record<string, unknown>;
  customerId: string | null;
}

@Injectable()
export class EmailService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailService.name);
  readonly queue: Queue<EmailJob>;
  private readonly connection: Redis;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: DB,
    private readonly settings: SettingsService,
    private readonly branding: BrandingService,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<EmailJob>(EMAIL_QUEUE, { connection: this.connection });
  }

  /** Queues an email; delivery is retried 5 times with exponential back-off starting at 30 s. */
  async send(
    templateKey: EmailTemplateKey,
    to: string,
    vars: Record<string, unknown>,
    ctx: { customerId?: string | null },
  ): Promise<void> {
    await this.queue.add(
      templateKey,
      { templateKey, to, vars, customerId: ctx.customerId ?? null },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  /** Sends the `test` template immediately, surfacing driver errors to the caller. */
  async sendTest(to: string): Promise<void> {
    const sent = await this.deliver({ templateKey: 'test', to, vars: {}, customerId: null });
    if (!sent) throw validation([], 'Email is not configured');
  }

  /** Renders and sends one email. Returns false when no driver is configured. */
  async deliver(job: EmailJob): Promise<boolean> {
    const transport = await this.driver();
    if (!transport) {
      this.logger.warn(`Email not configured; dropping ${job.templateKey} to ${job.to}`);
      return false;
    }
    const [branding, override] = await Promise.all([
      this.branding.resolve(job.customerId),
      this.override(job.templateKey, job.customerId),
    ]);
    // Uploaded assets are stored as relative URLs; mail clients need absolute ones.
    const origin = new URL(this.config.PUBLIC_URL).origin;
    for (const k of ['logoLightUrl', 'logoDarkUrl'] as const) {
      if (branding[k]?.startsWith('/')) branding[k] = origin + branding[k];
    }
    const rendered = await renderTemplate(job.templateKey, job.vars, branding, override);
    await transport.driver.send({ from: transport.from, to: job.to, ...rendered });
    return true;
  }

  private async override(key: EmailTemplateKey, customerId: string | null): Promise<TemplateOverride | null> {
    if (customerId) {
      const own = await this.db.query.emailTemplate.findFirst({
        where: and(eq(emailTemplate.key, key), eq(emailTemplate.customerId, customerId)),
      });
      if (own) return own;
    }
    return (
      (await this.db.query.emailTemplate.findFirst({
        where: and(eq(emailTemplate.key, key), isNull(emailTemplate.customerId)),
      })) ?? null
    );
  }

  private async driver(): Promise<{ driver: EmailDriver; from: string } | null> {
    const kind = await this.settings.get('email.driver');
    if (kind === 'smtp') {
      const smtp = await this.settings.get('email.smtp');
      return smtp ? { driver: new SmtpDriver(smtp), from: smtp.from } : null;
    }
    if (kind === 'ses') {
      const ses = await this.settings.get('email.ses');
      return ses ? { driver: new SesDriver(ses), from: ses.from } : null;
    }
    return null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
