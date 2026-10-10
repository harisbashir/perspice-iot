import { Inject, Injectable } from '@nestjs/common';
import {
  type EnergyData,
  type EnergyPeriod,
  type EnergyRange,
  ENERGY_PERIODS,
  KEY_PATTERN,
  calendarStart,
  groupEnergy,
  periodFor,
  previousCalendarStart,
  profileKeys,
} from '@perspice/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { customer, device, deviceProfile } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { TariffService } from './tariff.service';

const H = 3_600_000;
const MAX_RANGE_MS = 400 * 86_400_000;

export const EnergyQuery = z.object({
  key: z.string().regex(KEY_PATTERN),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  period: z.enum(ENERGY_PERIODS as [EnergyPeriod, ...EnergyPeriod[]]).optional(),
});

/**
 * Energy consumption and cost (spec §11) from a per-interval key (e.g. a counter_delta), summed
 * per hour from the hourly aggregate (avg × count), grouped into local periods and priced with the
 * customer's tariff.
 */
@Injectable()
export class EnergyService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly devices: DevicesService,
    private readonly tariffs: TariffService,
  ) {}

  async forDevice(actor: AuthUser, deviceId: string, raw: unknown): Promise<EnergyData> {
    const q = EnergyQuery.parse(raw);
    if (q.to <= q.from || q.to - q.from > MAX_RANGE_MS) throw validation([{ path: ['to'], message: 'Choose a range of up to 400 days' }]);
    const ctx = await this.context(actor, deviceId, q.key);
    const period = q.period ?? periodFor(q.from, q.to);
    const span = q.to - q.from;
    const [now, prev] = await Promise.all([this.hours([deviceId], q.key, q.from, q.to), this.hours([deviceId], q.key, q.from - span, q.from)]);
    return this.build(ctx, period, now, prev);
  }

  /** The `energy` dashboard data mode: the timewindow, or this local period so far. */
  async summary(actor: AuthUser, deviceId: string, key: string | undefined, range: EnergyRange, window: { from: number; to: number }): Promise<EnergyData> {
    if (!key) throw validation([], 'Choose the energy key');
    return this.summarise(await this.context(actor, deviceId, key), [deviceId], key, range, window);
  }

  private async summarise(ctx: Awaited<ReturnType<EnergyService['context']>>, deviceIds: string[], key: string, range: EnergyRange, window: { from: number; to: number }): Promise<EnergyData> {
    let { from, to } = window;
    let prevFrom = from - (to - from);
    if (range !== 'window') {
      to = Date.now();
      from = calendarStart(to, ctx.timezone, range);
      prevFrom = previousCalendarStart(from, ctx.timezone, range);
    }
    const period: EnergyPeriod = range === 'today' ? 'hour' : range === 'week' || range === 'month' ? 'day' : range === 'year' ? 'month' : periodFor(from, to);
    // The previous period up to the same point (e.g. the first 10 days of last month).
    const [now, prev] = await Promise.all([this.hours(deviceIds, key, from, to), this.hours(deviceIds, key, prevFrom, Math.min(from, prevFrom + (to - from)))]);
    return this.build(ctx, period, now, prev);
  }

  /**
   * The energy data mode over several devices (an asset's), summed per hour, in the customer's
   * timezone and priced with its tariff. The caller has resolved the devices within scope.
   */
  async summaryForDevices(customerId: string, deviceIds: string[], key: string | undefined, range: EnergyRange, window: { from: number; to: number }): Promise<EnergyData> {
    if (!key) throw validation([], 'Choose the energy key');
    const [tz, tariff, first] = await Promise.all([
      this.db.query.customer.findFirst({ where: eq(customer.id, customerId), columns: { timezone: true } }),
      this.tariffs.effective(customerId),
      deviceIds.length ? this.db.query.device.findFirst({ where: eq(device.id, deviceIds[0]!), columns: { profileId: true } }) : undefined,
    ]);
    const profile = first ? await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, first.profileId), columns: { telemetrySchema: true, calculated: true } }) : undefined;
    const ctx = { key, unit: profileKeys(profile).find((k) => k.key === key)?.unit ?? null, timezone: tz?.timezone ?? 'UTC', tariff };
    return this.summarise(ctx, deviceIds, key, range, window);
  }

  private async context(actor: AuthUser, deviceId: string, key: string) {
    const d = await this.devices.find(actor, deviceId); // scope: 404 outside it
    const [tz, profile, tariff] = await Promise.all([
      d.customerId ? this.db.query.customer.findFirst({ where: eq(customer.id, d.customerId), columns: { timezone: true } }) : undefined,
      this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, d.profileId), columns: { telemetrySchema: true, calculated: true } }),
      this.tariffs.effective(d.customerId),
    ]);
    const unit = profileKeys(profile).find((k) => k.key === key)?.unit ?? null;
    return { key, unit, timezone: tz?.timezone ?? 'UTC', tariff };
  }

  private build(ctx: Awaited<ReturnType<EnergyService['context']>>, period: EnergyPeriod, now: { ts: number; v: number }[], prev: { ts: number; v: number }[]): EnergyData {
    const grouped = groupEnergy(now, period, ctx.timezone, ctx.tariff);
    return {
      key: ctx.key,
      unit: ctx.unit,
      timezone: ctx.timezone,
      currency: ctx.tariff?.currency ?? null,
      period,
      periods: grouped.periods,
      total: grouped.total,
      previous: groupEnergy(prev, period, ctx.timezone, ctx.tariff).total,
    };
  }

  /** Hourly sums from the hourly aggregate, buckets starting in [from, to). */
  private async hours(deviceIds: string[], key: string, from: number, to: number): Promise<{ ts: number; v: number }[]> {
    if (to <= from || !deviceIds.length) return [];
    const start = new Date(Math.floor(from / H) * H);
    const res = await this.db.execute<{ ts: string; v: string }>(sql`
      SELECT (extract(epoch FROM bucket) * 1000)::bigint AS ts, sum(avg * count) AS v
      FROM telemetry_1h
      WHERE device_id IN (${sql.join(deviceIds.map((d) => sql`${d}::uuid`), sql`, `)}) AND key = ${key}
        AND bucket >= ${start.toISOString()} AND bucket < ${new Date(to).toISOString()} AND count > 0
      GROUP BY bucket`);
    return res.rows.map((r) => ({ ts: Number(r.ts), v: Number(r.v) }));
  }
}
