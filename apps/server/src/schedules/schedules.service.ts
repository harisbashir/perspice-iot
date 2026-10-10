import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { type ReportScheduleDto, type ReportScheduleInput, ReportScheduleInputSchema } from '@perspice/shared';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { AppError, notFound, validation } from '../common/app-error';
import { windowOf } from '../dashboards/data.service';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { customer, reportSchedule, user } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { EmailService } from '../email/email.service';
import { ExportsService, type JobRow, type StoredParams } from '../exports/exports.service';
import { ReportsService } from '../reports/reports.service';
import { JobRegistry } from '../scheduler/job-registry';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { nextRun } from './next-run';

type Row = typeof reportSchedule.$inferSelect;
const LINK_DAYS = 7;
const LINK_MS = LINK_DAYS * 86_400_000;

const toDto = (r: Row): ReportScheduleDto => ({
  ...r.spec,
  id: r.id,
  ownerId: r.ownerId,
  enabled: r.enabled,
  nextRunAt: r.nextRunAt?.getTime() ?? null,
  lastRun: r.lastRunAt ? { at: r.lastRunAt.getTime(), status: r.lastStatus!, message: r.lastMessage, jobId: r.lastJobId } : null,
});

/**
 * Scheduled dashboard reports and telemetry exports (spec §6.2). Runs act as the schedule's owner
 * with their current access: a deactivated owner, or one who can no longer see the device, gets
 * a skipped run and nothing is sent (Review Focus 5). Recipients get a 7-day download link.
 */
@Injectable()
export class SchedulesService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly devices: DevicesService,
    private readonly exportJobs: ExportsService,
    private readonly reports: ReportsService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_REPORT_JOBS') private readonly schedule: boolean,
  ) {}

  onModuleInit(): void {
    this.exportJobs.onJobFinished((job, params) => this.deliver(job, params));
  }

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('report-schedules', 60_000, () => this.runDue().then(() => undefined));
  }

  async list(actor: AuthUser): Promise<ReportScheduleDto[]> {
    const rows = await this.db.select().from(reportSchedule).where(eq(reportSchedule.ownerId, actor.id)).orderBy(reportSchedule.name);
    return rows.map(toDto);
  }

  async create(actor: AuthUser, body: unknown): Promise<ReportScheduleDto> {
    const spec = ReportScheduleInputSchema.parse(body);
    await this.check(actor, spec);
    const [row] = await this.db
      .insert(reportSchedule)
      .values({ ownerId: actor.id, customerId: actor.customerId, name: spec.name, spec, enabled: spec.enabled, nextRunAt: spec.enabled ? new Date(nextRun(spec.cadence, spec.timezone, Date.now())) : null })
      .returning();
    return toDto(row!);
  }

  async update(actor: AuthUser, id: string, body: unknown): Promise<ReportScheduleDto> {
    await this.find(actor, id);
    const spec = ReportScheduleInputSchema.parse(body);
    await this.check(actor, spec);
    const [row] = await this.db
      .update(reportSchedule)
      .set({ name: spec.name, spec, enabled: spec.enabled, nextRunAt: spec.enabled ? new Date(nextRun(spec.cadence, spec.timezone, Date.now())) : null, updatedAt: new Date() })
      .where(eq(reportSchedule.id, id))
      .returning();
    return toDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.find(actor, id);
    await this.db.delete(reportSchedule).where(eq(reportSchedule.id, id));
  }

  /** "Run now" (also used by `cli run-schedule`). */
  async runNow(actor: AuthUser | null, id: string): Promise<ReportScheduleDto> {
    const row = actor ? await this.find(actor, id) : await this.db.query.reportSchedule.findFirst({ where: eq(reportSchedule.id, id) });
    if (!row) throw notFound();
    await this.run(row, Date.now());
    return toDto((await this.db.query.reportSchedule.findFirst({ where: eq(reportSchedule.id, id) }))!);
  }

  /** Runs every due schedule once; claiming advances `next_run_at` so no instance runs it twice. */
  async runDue(now = Date.now()): Promise<number> {
    const due = await this.db
      .select()
      .from(reportSchedule)
      .where(and(eq(reportSchedule.enabled, true), lte(reportSchedule.nextRunAt, new Date(now))));
    let ran = 0;
    for (const row of due) {
      const next = new Date(nextRun(row.spec.cadence, row.spec.timezone, now));
      const [claimed] = await this.db
        .update(reportSchedule)
        .set({ nextRunAt: next })
        .where(and(eq(reportSchedule.id, row.id), eq(reportSchedule.nextRunAt, row.nextRunAt!)))
        .returning();
      if (!claimed) continue;
      await this.run(claimed, now).catch((err: Error) => this.logger.error(`Schedule ${row.id} failed: ${err.message}`));
      ran++;
    }
    return ran;
  }

  private async run(row: Row, now: number): Promise<void> {
    const record = (status: 'ok' | 'skipped' | 'failed', message: string, jobId: string | null = null) =>
      this.db.update(reportSchedule).set({ lastRunAt: new Date(now), lastStatus: status, lastMessage: message, lastJobId: jobId }).where(eq(reportSchedule.id, row.id));

    const actor = await this.auth.authUserForSession(row.ownerId, 'schedule');
    if (!actor) return void (await record('skipped', 'The owner of this schedule is no longer active'));
    if (!actor.permissions.includes('report.schedule') || !actor.permissions.includes('export.data')) {
      return void (await record('skipped', 'The owner no longer has permission to schedule reports'));
    }
    const spec = row.spec;
    const opts = { silent: true, retentionMs: LINK_MS, scheduleId: row.id };
    try {
      let job: JobRow;
      if (spec.target.kind === 'dashboard') {
        const t = spec.target;
        job = await this.reports.queueReport(actor, { ...(t.deviceId ? { deviceId: t.deviceId } : { overview: true }), stateId: t.stateId, timewindow: spec.timewindow }, opts);
      } else {
        const { from, to } = windowOf(spec.timewindow, now);
        job = await this.exportJobs.queueExport(actor, { kind: 'telemetry', format: spec.target.format, params: { deviceId: spec.target.deviceId, keys: spec.target.keys, from, to } }, opts);
      }
      await record('ok', 'Preparing the report', job.id);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) return void (await record('skipped', 'The owner can no longer see this dashboard or device'));
      await record('failed', (err as Error).message);
    }
  }

  /** When a scheduled job finishes: email the recipients a 7-day link (or record the failure). */
  private async deliver(job: JobRow, params: StoredParams): Promise<void> {
    if (!params.scheduleId) return;
    const row = await this.db.query.reportSchedule.findFirst({ where: eq(reportSchedule.id, params.scheduleId) });
    if (!row) return;
    const record = (status: 'ok' | 'failed', message: string) =>
      this.db.update(reportSchedule).set({ lastStatus: status, lastMessage: message }).where(eq(reportSchedule.id, row.id));
    if (job.status !== 'done' || !job.fileKey) return void (await record('failed', job.error ?? 'The report could not be produced'));

    const owner = await this.db.query.user.findFirst({ where: eq(user.id, row.ownerId) });
    const recipients = await this.recipients(row.spec.recipients, owner?.customerId ?? null);
    const path = await this.storage.getSignedUrl(job.fileKey, Math.floor(LINK_MS / 1000));
    const expiresAt = `${new Date(Date.now() + LINK_MS).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    for (const r of recipients) {
      await this.email.send(
        'report_delivery',
        r.email,
        { name: r.name, title: params.title, scheduleName: row.name, link: this.auth.publicUrlFor(r.slug) + path, expiresAt },
        { customerId: r.customerId },
      );
    }
    await record('ok', `Sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`);
  }

  /** Active recipients who belong to the owner's tenant (platform owners may add the device customer's users). */
  private async recipients(ids: string[], ownerCustomerId: string | null, extraCustomerId: string | null = null) {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: user.id, email: user.email, name: user.name, customerId: user.customerId, scopeType: user.scopeType, slug: customer.slug })
      .from(user)
      .leftJoin(customer, eq(customer.id, user.customerId))
      .where(and(inArray(user.id, ids), eq(user.status, 'active')));
    return rows.filter((u) =>
      ownerCustomerId ? u.customerId === ownerCustomerId : u.scopeType === 'platform' || (extraCustomerId !== null && u.customerId === extraCustomerId),
    );
  }

  private async check(actor: AuthUser, spec: ReportScheduleInput): Promise<void> {
    const device = spec.target.deviceId ? await this.devices.find(actor, spec.target.deviceId) : null; // 404 when not visible
    if (spec.target.kind === 'dashboard' && !spec.target.deviceId && !spec.target.overview) {
      throw validation([{ path: ['target'], message: 'Choose a device dashboard or the overview' }]);
    }
    const ok = await this.recipients(spec.recipients, actor.scopeType === 'customer' ? actor.customerId : null, device?.customerId ?? null);
    if (ok.length !== new Set(spec.recipients).size) {
      throw validation([{ path: ['recipients'], message: 'Recipients must be active users of your organisation' }]);
    }
  }

  private async find(actor: AuthUser, id: string): Promise<Row> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.reportSchedule.findFirst({ where: and(eq(reportSchedule.id, id), eq(reportSchedule.ownerId, actor.id)) });
    if (!row) throw notFound();
    return row;
  }
}
