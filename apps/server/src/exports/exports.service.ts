import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  EXPORT_PDF_ROW_LIMIT,
  EXPORT_SYNC_ROW_LIMIT,
  type ExportJobDto,
  type ExportRequest,
  ExportRequestSchema,
} from '@perspice/shared';
import { Queue } from 'bullmq';
import { and, desc, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { Response } from 'express';
import Redis from 'ioredis';
import { PassThrough } from 'node:stream';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { BrandingService } from '../branding/branding.service';
import { notFound, validation } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { customer, exportJob, user } from '../db/schema';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { ExportSources } from './export-sources';
import { CONTENT_TYPES, writeExport } from './writers';

export const EXPORTS_QUEUE = 'exports';
const RETENTION_MS = 24 * 3_600_000;
const LINK_TTL_S = 300;

type JobRow = typeof exportJob.$inferSelect;

/** What a background job needs to act as the requester: their scope and permissions at request time. */
type ActorSnapshot = Pick<AuthUser, 'kind' | 'apiKeyId' | 'scopeType' | 'customerId' | 'groupId' | 'permissions'>;

interface StoredParams {
  title: string;
  request: ExportRequest;
  actor: ActorSnapshot;
}

export function exportFilename(title: string, format: string, now = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'); // 20260102-0304
  return `${slug}-${stamp}.${format}`;
}

/**
 * Exports run inline up to EXPORT_SYNC_ROW_LIMIT rows (streamed straight to the response) and as
 * BullMQ jobs above it: the file goes to storage, the requester is notified, and the download
 * link works for its owner only until the file is removed 24 h later (Review Focus 4).
 */
@Injectable()
export class ExportsService implements OnApplicationShutdown {
  private readonly logger = new Logger(ExportsService.name);
  readonly queue: Queue<{ jobId: string }>;
  private readonly connection: Redis;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(DB) private readonly db: DB,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly sources: ExportSources,
    private readonly branding: BrandingService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {
    this.connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(EXPORTS_QUEUE, { connection: this.connection });
  }

  /** Streams the export to `res`, or answers 202 with a queued job when it is too large. */
  async export(actor: AuthUser, body: unknown, res: Response): Promise<void> {
    const req = ExportRequestSchema.parse(body);
    const source = await this.sources.for(actor, req);
    const rows = await source.count();
    if (req.format === 'pdf' && rows > EXPORT_PDF_ROW_LIMIT) {
      throw validation(
        [{ path: ['format'], message: `PDF exports are limited to ${EXPORT_PDF_ROW_LIMIT.toLocaleString('en')} rows` }],
        `This export has ${rows.toLocaleString('en')} rows; choose CSV or XLSX instead of PDF`,
      );
    }
    if (rows > EXPORT_SYNC_ROW_LIMIT) {
      const job = await this.enqueue(actor, req, source.title);
      res.status(202).json(await this.toDto(job));
      return;
    }
    res.status(200);
    res.setHeader('content-type', CONTENT_TYPES[req.format]);
    res.setHeader('content-disposition', `attachment; filename="${exportFilename(source.title, req.format)}"`);
    res.setHeader('cache-control', 'no-store');
    const branding = await this.branding.resolve(actor.customerId);
    try {
      await writeExport(req.format, { ...source, rows: source.rows(), branding }, res);
    } catch (err) {
      // Headers are gone; all we can do is cut the download short so it is visibly incomplete.
      this.logger.error(`Export failed mid-stream: ${(err as Error).message}`);
      res.destroy(err as Error);
    }
  }

  private async enqueue(actor: AuthUser, request: ExportRequest, title: string): Promise<JobRow> {
    const params: StoredParams = {
      title,
      request,
      actor: {
        kind: actor.kind,
        apiKeyId: actor.apiKeyId,
        scopeType: actor.scopeType,
        customerId: actor.customerId,
        groupId: actor.groupId,
        permissions: actor.permissions,
      },
    };
    const [job] = await this.db
      .insert(exportJob)
      .values({
        userId: actor.id,
        customerId: actor.customerId,
        kind: request.kind,
        format: request.format,
        params: params as unknown as Record<string, unknown>,
      })
      .returning();
    await this.queue.add('export', { jobId: job!.id }, { jobId: job!.id, removeOnComplete: 1000, removeOnFail: 1000 });
    return job!;
  }

  /** Runs one background export (BullMQ worker, scheduler role). */
  async process(jobId: string): Promise<void> {
    const job = await this.db.query.exportJob.findFirst({ where: eq(exportJob.id, jobId) });
    if (!job || job.status !== 'queued') return;
    const owner = await this.db.query.user.findFirst({ where: eq(user.id, job.userId) });
    const params = job.params as unknown as StoredParams;
    await this.db.update(exportJob).set({ status: 'running', updatedAt: new Date() }).where(eq(exportJob.id, jobId));
    try {
      if (!owner || owner.status !== 'active') throw new Error('The requesting user is no longer active');
      const actor: AuthUser = {
        ...params.actor,
        id: owner.id,
        sessionId: null,
        email: owner.email,
        name: owner.name,
        roleId: owner.roleId,
        roleKey: null,
        totpEnabled: owner.totpEnabled,
      };
      const source = await this.sources.for(actor, params.request);
      const key = `exports/${owner.id}/${jobId}/${exportFilename(params.title, job.format, job.createdAt)}`;
      const out = new PassThrough();
      const stored = this.storage.putStream(key, out, CONTENT_TYPES[job.format]);
      let rowCount: number;
      try {
        rowCount = await writeExport(job.format, { ...source, rows: source.rows(), branding: await this.branding.resolve(actor.customerId) }, out);
      } catch (err) {
        out.destroy(err as Error);
        await stored.catch(() => undefined);
        throw err;
      }
      await stored;
      const now = new Date();
      await this.db
        .update(exportJob)
        .set({ status: 'done', rowCount, fileKey: key, expiresAt: new Date(now.getTime() + RETENTION_MS), updatedAt: now })
        .where(eq(exportJob.id, jobId));
      await this.notifyReady(owner, jobId, params.title, rowCount);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Export ${jobId} failed: ${message}`);
      await this.db.update(exportJob).set({ status: 'failed', error: message, updatedAt: new Date() }).where(eq(exportJob.id, jobId));
      if (owner) {
        await this.notifications.create(owner.id, {
          type: 'export.failed',
          severity: 'warning',
          title: 'Export failed',
          body: `${params.title}: ${message}`,
          link: `/exports/${jobId}`,
        });
      }
    }
  }

  private async notifyReady(owner: typeof user.$inferSelect, jobId: string, title: string, rowCount: number): Promise<void> {
    const link = `/exports/${jobId}`;
    await this.notifications.create(owner.id, {
      type: 'export.ready',
      severity: 'info',
      title: 'Your export is ready',
      body: `${title} (${rowCount.toLocaleString('en')} rows). The download is available for 24 hours.`,
      link,
    });
    const c = owner.customerId ? await this.db.query.customer.findFirst({ where: eq(customer.id, owner.customerId) }) : undefined;
    await this.email.send(
      'export_ready',
      owner.email,
      { name: owner.name, title, rowCount: rowCount.toLocaleString('en'), link: this.auth.publicUrlFor(c?.slug ?? null) + link },
      { customerId: owner.customerId },
    );
  }

  async list(actor: AuthUser): Promise<ExportJobDto[]> {
    const rows = await this.db
      .select()
      .from(exportJob)
      .where(eq(exportJob.userId, actor.id))
      .orderBy(desc(exportJob.createdAt))
      .limit(50);
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  /** Jobs are private to the user who requested them; anyone else gets 404. */
  async get(actor: AuthUser, id: string): Promise<ExportJobDto> {
    if (!isUuid(id)) throw notFound();
    const job = await this.db.query.exportJob.findFirst({ where: and(eq(exportJob.id, id), eq(exportJob.userId, actor.id)) });
    if (!job) throw notFound();
    return this.toDto(job);
  }

  /** Deletes expired files and their jobs, and failed jobs older than the retention period. */
  async cleanup(now = new Date()): Promise<number> {
    const stale = await this.db
      .select()
      .from(exportJob)
      .where(
        or(
          and(isNotNull(exportJob.expiresAt), lt(exportJob.expiresAt, now)),
          and(eq(exportJob.status, 'failed'), lt(exportJob.createdAt, new Date(now.getTime() - RETENTION_MS))),
        ),
      );
    for (const job of stale) {
      if (job.fileKey) await this.storage.delete(job.fileKey);
      await this.db.delete(exportJob).where(eq(exportJob.id, job.id));
    }
    return stale.length;
  }

  private async toDto(j: JobRow, now = Date.now()): Promise<ExportJobDto> {
    const live = j.status === 'done' && j.fileKey && j.expiresAt && j.expiresAt.getTime() > now;
    return {
      id: j.id,
      kind: j.kind as ExportJobDto['kind'],
      format: j.format,
      title: (j.params as unknown as StoredParams).title,
      status: j.status,
      rowCount: j.rowCount,
      error: j.error,
      createdAt: j.createdAt.getTime(),
      expiresAt: j.expiresAt?.getTime() ?? null,
      downloadUrl: live ? await this.storage.getSignedUrl(j.fileKey!, LINK_TTL_S) : null,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
