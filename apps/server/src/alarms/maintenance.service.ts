import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type AlarmCondition, type DeviceServiceDto, DeviceServiceInputSchema, KEY_PATTERN, type RunHoursDto } from '@perspice/shared';
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { alarmRule, device, deviceProfile, deviceService } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { JobRegistry } from '../scheduler/job-registry';
import { AlarmStore } from './alarm-store';
import { type RuleTarget, effectiveRules } from './effective';

const CHECK_INTERVAL_MS = 3_600_000;
const DAY_MS = 86_400_000;
type Condition = AlarmCondition<'maintenance_due'>;
type ServiceRow = typeof deviceService.$inferSelect;

const hours = (h: number) => `${Number(h.toFixed(1))} h`;
const toDto = (r: ServiceRow): DeviceServiceDto => ({
  id: r.id,
  deviceId: r.deviceId,
  servicedAt: r.servicedAt.getTime(),
  note: r.note,
  runHours: r.runHours,
  createdBy: r.createdBy,
});

/** Whether a maintenance rule is due for a device, and the reminder text. */
export function maintenanceDue(c: Condition, runSinceH: number | null, daysSince: number): { due: boolean; message: string } | null {
  const checks: { frac: number; text: string }[] = [];
  if (c.everyHours !== undefined && runSinceH !== null) checks.push({ frac: runSinceH / c.everyHours, text: `${hours(runSinceH)} run since the last service (every ${hours(c.everyHours)})` });
  if (c.everyDays !== undefined) checks.push({ frac: daysSince / c.everyDays, text: `${Math.floor(daysSince)} days since the last service (every ${c.everyDays} days)` });
  const worst = checks.sort((a, b) => b.frac - a.frac)[0];
  if (!worst || worst.frac < c.remindAtPct / 100) return null;
  return { due: worst.frac >= 1, message: `${worst.frac >= 1 ? 'Service due' : 'Service due soon'}: ${worst.text}` };
}

/**
 * Maintenance reminders (spec §6.1 `maintenance_due`, §11): hourly, every device with such a rule
 * is checked against its run hours (a runtime key's total minus the total at the last service) and
 * the days since that service (or since the device was added). Logging a service clears it.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly store: AlarmStore,
    private readonly devices: DevicesService,
  ) {}

  /** Checks every device with a maintenance rule (or one device); returns how many were checked. */
  async check(now = Date.now(), onlyDeviceId?: string): Promise<number> {
    const rules = await this.db
      .select()
      .from(alarmRule)
      .where(or(eq(alarmRule.type, 'maintenance_due'), isNotNull(alarmRule.disablesRuleId)));
    const maintenance = rules.filter((r) => r.type === 'maintenance_due' && !r.disablesRuleId && r.enabled);
    if (!maintenance.length) return 0;
    const profileIds = maintenance.flatMap((r) => (r.scopeKind === 'profile' && r.profileId ? [r.profileId] : []));
    const customerIds = maintenance.flatMap((r) => (r.scopeKind === 'customer' && r.customerId ? [r.customerId] : []));
    const deviceIds = maintenance.flatMap((r) => (r.scopeKind === 'device' && r.deviceId ? [r.deviceId] : []));
    const candidates = await this.db
      .select({ id: device.id, profileId: device.profileId, customerId: device.customerId, createdAt: device.createdAt })
      .from(device)
      .where(
        and(
          or(
            profileIds.length ? inArray(device.profileId, profileIds) : undefined,
            customerIds.length ? inArray(device.customerId, customerIds) : undefined,
            deviceIds.length ? inArray(device.id, deviceIds) : undefined,
          ),
          onlyDeviceId ? eq(device.id, onlyDeviceId) : undefined,
        ),
      );
    if (!candidates.length) return 0;
    const ids = candidates.map((d) => d.id);
    const keys = [...new Set(maintenance.map((r) => (r.condition as Condition).runtimeKey).filter((k): k is string => !!k))];
    const [last, totals] = await Promise.all([this.lastServices(ids), this.totals(ids, keys)]);

    for (const d of candidates) {
      const target: RuleTarget = { id: d.id, profileId: d.profileId, customerId: d.customerId };
      const service = last.get(d.id);
      const since = service?.servicedAt.getTime() ?? d.createdAt.getTime();
      for (const rule of effectiveRules(rules, target).filter((r) => r.type === 'maintenance_due')) {
        const c = rule.condition as Condition;
        const runSince = c.runtimeKey ? (totals.get(`${d.id}/${c.runtimeKey}`) ?? 0) - (service?.runHours[c.runtimeKey] ?? 0) : null;
        const result = maintenanceDue(c, runSince === null ? null : Math.max(0, runSince), (now - since) / DAY_MS);
        if (result) {
          await this.store.raise(rule, target, c.runtimeKey && runSince !== null ? { key: c.runtimeKey, v: Number(runSince.toFixed(1)) } : undefined, result.message, now);
        } else {
          await this.store.clearOpen(rule, d.id, undefined, now);
        }
      }
    }
    return candidates.length;
  }

  async runHours(actor: AuthUser, deviceId: string, raw: unknown): Promise<RunHoursDto> {
    const { key } = z.object({ key: z.string().regex(KEY_PATTERN) }).parse(raw);
    await this.devices.find(actor, deviceId); // scope: 404 outside it
    const [totals, last] = await Promise.all([this.totals([deviceId], [key]), this.lastServices([deviceId])]);
    const total = round1(totals.get(`${deviceId}/${key}`) ?? 0);
    const service = last.get(deviceId);
    return { key, total, sinceService: round1(Math.max(0, total - (service?.runHours[key] ?? 0))), lastService: service ? toDto(service) : null };
  }

  async list(actor: AuthUser, deviceId: string): Promise<DeviceServiceDto[]> {
    await this.devices.find(actor, deviceId);
    const rows = await this.db.select().from(deviceService).where(eq(deviceService.deviceId, deviceId)).orderBy(desc(deviceService.servicedAt)).limit(200);
    return rows.map(toDto);
  }

  /** Logs a service with the run-hour totals of the device's runtime keys, then re-checks it. */
  async log(actor: AuthUser, deviceId: string, raw: unknown): Promise<DeviceServiceDto> {
    const input = DeviceServiceInputSchema.parse(raw ?? {});
    const now = Date.now();
    if (input.servicedAt !== undefined && input.servicedAt > now + 60_000) throw validation([{ path: ['servicedAt'], message: 'Not in the future' }]);
    const d = await this.devices.find(actor, deviceId);
    const keys = await this.runtimeKeys(d.profileId);
    const totals = await this.totals([d.id], keys);
    const runHours = Object.fromEntries(keys.map((k) => [k, round1(totals.get(`${d.id}/${k}`) ?? 0)]));
    const [row] = await this.db
      .insert(deviceService)
      .values({ deviceId: d.id, servicedAt: new Date(input.servicedAt ?? now), note: input.note, runHours, createdBy: actor.kind === 'user' ? actor.id : null })
      .returning();
    await this.check(now, d.id);
    return toDto(row!);
  }

  /** The profile's runtime keys and those maintenance rules read. */
  private async runtimeKeys(profileId: string): Promise<string[]> {
    const profile = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, profileId), columns: { calculated: true } });
    const fromProfile = (profile?.calculated ?? []).filter((c) => c.kind === 'runtime').map((c) => c.key);
    const rules = await this.db.select({ condition: alarmRule.condition }).from(alarmRule).where(eq(alarmRule.type, 'maintenance_due'));
    const fromRules = rules.map((r) => (r.condition as Condition).runtimeKey).filter((k): k is string => !!k);
    return [...new Set([...fromProfile, ...fromRules])];
  }

  private async lastServices(ids: string[]): Promise<Map<string, ServiceRow>> {
    const rows = await this.db
      .selectDistinctOn([deviceService.deviceId])
      .from(deviceService)
      .where(inArray(deviceService.deviceId, ids))
      .orderBy(deviceService.deviceId, desc(deviceService.servicedAt));
    return new Map(rows.map((r) => [r.deviceId, r]));
  }

  /** Total run hours per device and key (`id/key`), from the daily aggregate (seconds summed). */
  private async totals(ids: string[], keys: string[]): Promise<Map<string, number>> {
    if (!ids.length || !keys.length) return new Map();
    const res = await this.db.execute<{ device_id: string; key: string; s: string }>(sql`
      SELECT device_id, key, sum(avg * count) AS s FROM telemetry_1d
      WHERE device_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) AND count > 0
      GROUP BY device_id, key`);
    return new Map(res.rows.map((r) => [`${r.device_id}/${r.key}`, Number(r.s) / 3600]));
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scheduler: maintenance reminders once an hour. */
@Injectable()
export class MaintenanceJob implements OnApplicationBootstrap {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly jobs: JobRegistry,
    @Inject('SCHEDULE_ALARM_JOBS') private readonly schedule: boolean,
  ) {}

  onApplicationBootstrap(): void {
    if (this.schedule) this.jobs.every('maintenance-check', CHECK_INTERVAL_MS, () => this.maintenance.check().then(() => undefined));
  }
}

