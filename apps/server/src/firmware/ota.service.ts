import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  OTA_DEVICE_STATES,
  type OtaDeviceDto,
  type OtaDeviceState,
  type OtaJobDto,
  OtaJobInputSchema,
  type OtaMessage,
  OtaProgressSchema,
} from '@perspice/shared';
import { and, arrayContains, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { CommandsPublisher } from '../commands/commands.publisher';
import { notFound, validation } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { device, deviceProfile, firmware, otaJob, otaJobDevice } from '../db/schema';
import { JobRegistry } from '../scheduler/job-registry';
import { FirmwareService } from './firmware.service';
import { planRollout } from './ota.rollout';

const TICK_MS = 15_000;
/** Download links in OTA messages stay valid this long. */
const LINK_TTL_S = 24 * 3600;
const IN_FLIGHT: OtaDeviceState[] = ['sent', 'downloading', 'verifying'];

type JobRow = typeof otaJob.$inferSelect;

/**
 * OTA rollouts (spec §5.1 `ota`, `ota/progress`). The scheduler ticks running jobs: it fails
 * devices past the timeout, halts on too many failures, and sends the next devices (online ones,
 * at most a batch in flight). A device is `applied` once it reports the new `fw` attribute.
 */
@Injectable()
export class OtaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OtaService.name);

  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(CONFIG) private readonly config: Config,
    private readonly firmware: FirmwareService,
    private readonly publisher: CommandsPublisher,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_OTA') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('ota-rollout', TICK_MS, () => this.tick().then(() => undefined));
  }

  async create(actor: AuthUser, body: unknown): Promise<OtaJobDto> {
    const input = OtaJobInputSchema.parse(body);
    const fw = await this.firmware.find(input.firmwareId);
    const t = input.target;
    const targets =
      t.kind === 'devices'
        ? await this.db.select({ id: device.id, profileId: device.profileId, fw: device.firmwareVersion }).from(device).where(inArray(device.id, t.deviceIds))
        : await this.db
            .select({ id: device.id, profileId: device.profileId, fw: device.firmwareVersion })
            .from(device)
            .where(and(eq(device.profileId, fw.profileId), t.customerId ? eq(device.customerId, t.customerId) : undefined, t.tags.length ? arrayContains(device.tags, t.tags) : undefined));
    if (t.kind === 'devices') {
      const wrong = t.deviceIds.length - targets.filter((d) => d.profileId === fw.profileId).length;
      if (wrong) throw validation([{ path: ['target', 'deviceIds'], message: `${wrong} of the devices don't exist or aren't of this firmware's profile` }]);
    }
    if (!targets.length) throw validation([{ path: ['target'], message: 'No devices to update' }]);
    const job = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(otaJob)
        .values({ firmwareId: fw.id, target: t, batchSize: input.batchSize, maxFailurePct: input.maxFailurePct, timeoutMin: input.timeoutMin, createdBy: actor.id })
        .returning();
      await tx.insert(otaJobDevice).values(targets.map((d) => ({ jobId: row!.id, deviceId: d.id, state: (d.fw === fw.version ? 'skipped' : 'pending') as OtaDeviceState })));
      return row!;
    });
    return this.dto(job);
  }

  /** One rollout step for every running job. `now` is injectable for tests. */
  async tick(now = Date.now()): Promise<void> {
    const running = await this.db.select().from(otaJob).where(eq(otaJob.status, 'running'));
    for (const job of running) {
      await this.step(job, now).catch((err: Error) => this.logger.error(`OTA job ${job.id}: ${err.message}`));
    }
  }

  private async step(job: JobRow, now: number): Promise<void> {
    const rows = await this.db
      .select({
        deviceId: otaJobDevice.deviceId,
        state: otaJobDevice.state,
        firstSentAt: otaJobDevice.firstSentAt,
        lastSentAt: otaJobDevice.lastSentAt,
        status: device.status,
        connectedAt: device.mqttSessionConnectedAt,
      })
      .from(otaJobDevice)
      .innerJoin(device, eq(device.id, otaJobDevice.deviceId))
      .where(eq(otaJobDevice.jobId, job.id))
      .orderBy(device.name);
    const plan = planRollout(
      job,
      rows.map((r) => ({ deviceId: r.deviceId, state: r.state, sentAt: r.firstSentAt?.getTime() ?? null, online: r.status === 'online' })),
      now,
    );
    if (plan.timedOut.length) await this.setState(job.id, plan.timedOut, { state: 'failed', error: 'Timed out' });
    if (plan.halt) {
      await this.db.update(otaJob).set({ status: 'halted', haltReason: plan.halt, updatedAt: new Date(now) }).where(eq(otaJob.id, job.id));
      return;
    }
    if (plan.complete) {
      await this.db.update(otaJob).set({ status: 'completed', finishedAt: new Date(now), updatedAt: new Date(now) }).where(eq(otaJob.id, job.id));
      return;
    }
    // A device that reconnected since it was sent the update gets it again (the message may be lost).
    const resend = rows
      .filter((r) => r.state === 'sent' && r.lastSentAt && r.connectedAt && r.connectedAt > r.lastSentAt && !plan.timedOut.includes(r.deviceId))
      .map((r) => r.deviceId);
    const send = [...plan.send, ...resend];
    if (!send.length) return;
    const message = await this.messageOf(job);
    const transports = await this.transportsOf(send);
    // Only what was actually published counts as sent; the rest is tried again next tick.
    const delivered: string[] = [];
    for (const deviceId of send) {
      if (transports.get(deviceId) === 'http') {
        delivered.push(deviceId); // HTTP devices fetch it from GET /api/v1/device/ota
        continue;
      }
      try {
        await this.publisher.publishOta(deviceId, message);
        delivered.push(deviceId);
      } catch (err) {
        this.logger.warn(`OTA to ${deviceId} not sent: ${(err as Error).message}`);
      }
    }
    const fresh = plan.send.filter((id) => delivered.includes(id));
    if (fresh.length) {
      await this.db
        .update(otaJobDevice)
        .set({ state: 'sent', firstSentAt: new Date(now), lastSentAt: new Date(now), updatedAt: new Date(now) })
        .where(and(eq(otaJobDevice.jobId, job.id), inArray(otaJobDevice.deviceId, fresh)));
    }
    const again = resend.filter((id) => delivered.includes(id));
    if (again.length) {
      await this.db.update(otaJobDevice).set({ lastSentAt: new Date(now) }).where(and(eq(otaJobDevice.jobId, job.id), inArray(otaJobDevice.deviceId, again)));
    }
  }

  private async transportsOf(deviceIds: string[]): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: device.id, transport: deviceProfile.transport })
      .from(device)
      .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
      .where(inArray(device.id, deviceIds));
    return new Map(rows.map((r) => [r.id, r.transport]));
  }

  private async messageOf(job: JobRow): Promise<OtaMessage> {
    const fw = await this.firmware.find(job.firmwareId);
    const link = await this.firmware.downloadUrl(fw.id, LINK_TTL_S);
    return { jobId: job.id, version: fw.version, url: new URL(link, this.config.PUBLIC_URL).toString(), sha256: fw.sha256, size: fw.size };
  }

  private async setState(jobId: string, deviceIds: string[], set: { state: OtaDeviceState; error?: string | null; pct?: number | null }): Promise<void> {
    await this.db
      .update(otaJobDevice)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(otaJobDevice.jobId, jobId), inArray(otaJobDevice.deviceId, deviceIds)));
  }

  /** The device's in-flight row for `version` in a job that is still running or halted. */
  private async activeRow(deviceId: string, version: string) {
    const [row] = await this.db
      .select({ jobId: otaJobDevice.jobId })
      .from(otaJobDevice)
      .innerJoin(otaJob, eq(otaJob.id, otaJobDevice.jobId))
      .innerJoin(firmware, eq(firmware.id, otaJob.firmwareId))
      .where(and(eq(otaJobDevice.deviceId, deviceId), inArray(otaJobDevice.state, IN_FLIGHT), eq(firmware.version, version), inArray(otaJob.status, ['running', 'halted'])))
      .orderBy(desc(otaJob.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** `ota/progress` from a device. Returns false for a message that matches no update. */
  async progress(deviceId: string, payload: unknown): Promise<boolean> {
    const p = OtaProgressSchema.safeParse(payload);
    if (!p.success) return false;
    const row = await this.activeRow(deviceId, p.data.version);
    if (!row) return false;
    if (p.data.state === 'failed') {
      await this.setState(row.jobId, [deviceId], { state: 'failed', error: p.data.error ?? 'The device reported a failure' });
    } else if (p.data.state === 'applied') {
      // Applied once the device comes back reporting the version (it may already have).
      const d = await this.db.query.device.findFirst({ where: eq(device.id, deviceId), columns: { firmwareVersion: true } });
      await this.setState(row.jobId, [deviceId], { state: d?.firmwareVersion === p.data.version ? 'applied' : 'verifying', pct: 100 });
    } else {
      await this.setState(row.jobId, [deviceId], { state: p.data.state, pct: p.data.pct ?? null });
    }
    return true;
  }

  /** The device reported firmware `version` (the `fw` attribute): updates to it are applied. */
  async firmwareReported(deviceId: string, version: string): Promise<void> {
    const row = await this.activeRow(deviceId, version);
    if (row) await this.setState(row.jobId, [deviceId], { state: 'applied', pct: 100, error: null });
  }

  /** For HTTP devices: the update they should apply now, if any. */
  async messageFor(deviceId: string): Promise<OtaMessage | null> {
    const [row] = await this.db
      .select({ job: otaJob })
      .from(otaJobDevice)
      .innerJoin(otaJob, eq(otaJob.id, otaJobDevice.jobId))
      .where(and(eq(otaJobDevice.deviceId, deviceId), inArray(otaJobDevice.state, IN_FLIGHT), eq(otaJob.status, 'running')))
      .orderBy(desc(otaJob.createdAt))
      .limit(1);
    return row ? this.messageOf(row.job) : null;
  }

  async cancel(id: string): Promise<OtaJobDto> {
    const job = await this.find(id);
    if (job.status === 'running' || job.status === 'halted') {
      await this.db.transaction(async (tx) => {
        await tx.update(otaJob).set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() }).where(eq(otaJob.id, job.id));
        await tx.update(otaJobDevice).set({ state: 'skipped', updatedAt: new Date() }).where(and(eq(otaJobDevice.jobId, job.id), eq(otaJobDevice.state, 'pending')));
      });
    }
    return this.dto(await this.find(id));
  }

  async list(firmwareId?: string): Promise<OtaJobDto[]> {
    const rows = await this.db.select().from(otaJob).where(firmwareId ? eq(otaJob.firmwareId, firmwareId) : undefined).orderBy(desc(otaJob.createdAt)).limit(200);
    return Promise.all(rows.map((r) => this.dto(r)));
  }

  async get(id: string): Promise<OtaJobDto> {
    return this.dto(await this.find(id));
  }

  async devices(id: string): Promise<OtaDeviceDto[]> {
    const job = await this.find(id);
    const rows = await this.db
      .select({ deviceId: otaJobDevice.deviceId, deviceName: device.name, state: otaJobDevice.state, pct: otaJobDevice.pct, error: otaJobDevice.error, updatedAt: otaJobDevice.updatedAt })
      .from(otaJobDevice)
      .innerJoin(device, eq(device.id, otaJobDevice.deviceId))
      .where(eq(otaJobDevice.jobId, job.id))
      .orderBy(device.name);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }));
  }

  /** A device's updates (the caller has checked it may see the device). */
  async forDevice(deviceId: string): Promise<{ jobId: string; version: string; jobStatus: string; state: OtaDeviceState; pct: number | null; error: string | null; updatedAt: number }[]> {
    const rows = await this.db
      .select({ jobId: otaJob.id, version: firmware.version, jobStatus: otaJob.status, state: otaJobDevice.state, pct: otaJobDevice.pct, error: otaJobDevice.error, updatedAt: otaJobDevice.updatedAt })
      .from(otaJobDevice)
      .innerJoin(otaJob, eq(otaJob.id, otaJobDevice.jobId))
      .innerJoin(firmware, eq(firmware.id, otaJob.firmwareId))
      .where(eq(otaJobDevice.deviceId, deviceId))
      .orderBy(desc(otaJob.createdAt))
      .limit(50);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }));
  }

  private async find(id: string): Promise<JobRow> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.otaJob.findFirst({ where: eq(otaJob.id, id) });
    if (!row) throw notFound();
    return row;
  }

  private async dto(job: JobRow): Promise<OtaJobDto> {
    const fw = await this.db.query.firmware.findFirst({ where: eq(firmware.id, job.firmwareId) });
    const counted = await this.db
      .select({ state: otaJobDevice.state, n: sql<number>`count(*)::int` })
      .from(otaJobDevice)
      .where(eq(otaJobDevice.jobId, job.id))
      .groupBy(otaJobDevice.state);
    const counts = Object.fromEntries(OTA_DEVICE_STATES.map((s) => [s, 0])) as Record<OtaDeviceState, number>;
    for (const c of counted) counts[c.state] = c.n;
    return {
      id: job.id,
      firmware: { id: job.firmwareId, version: fw?.version ?? '', profileId: fw?.profileId ?? '' },
      status: job.status,
      target: job.target,
      batchSize: job.batchSize,
      maxFailurePct: job.maxFailurePct,
      timeoutMin: job.timeoutMin,
      counts,
      haltReason: job.haltReason,
      createdAt: job.createdAt.getTime(),
      finishedAt: job.finishedAt?.getTime() ?? null,
    };
  }
}
