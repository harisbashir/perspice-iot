import { Inject, Injectable } from '@nestjs/common';
import type { LatestValue } from '@perspice/shared';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { DB } from '../db/db.module';
import { deviceProfile, telemetry, telemetryLatest } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { LatestCache } from '../ingest/latest-cache';
import { type TelemetrySource, selectSource } from './source-select';
import { retentionCutoff } from './retention';

export type Aggregation = 'auto' | 'raw' | 'avg' | 'min' | 'max';

export interface HistoryQuery {
  keys: string[];
  from: number;
  to: number;
  agg: Aggregation;
  limit: number;
}

export interface HistoryResult {
  source: TelemetrySource;
  series: Record<string, [number, unknown][]>;
}

const AGG_VIEWS: Record<Exclude<TelemetrySource, 'raw'>, string> = {
  '1m': 'telemetry_1m',
  '1h': 'telemetry_1h',
  '1d': 'telemetry_1d',
};

type StoredValue = { valueNum: number | null; valueStr: string | null; valueBool: boolean | null; valueJson: unknown };
const stored = (r: StoredValue): unknown => r.valueNum ?? r.valueStr ?? r.valueBool ?? r.valueJson;

@Injectable()
export class TelemetryService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly devices: DevicesService,
    private readonly latestCache: LatestCache,
  ) {}

  async latest(actor: AuthUser, deviceId: string): Promise<Record<string, LatestValue>> {
    await this.devices.find(actor, deviceId);
    const cached = await this.latestCache.get(deviceId);
    if (Object.keys(cached).length) return cached;
    const rows = await this.db.select().from(telemetryLatest).where(eq(telemetryLatest.deviceId, deviceId));
    return Object.fromEntries(rows.map((r) => [r.key, { ts: r.ts.getTime(), v: stored(r) }]));
  }

  async keys(actor: AuthUser, deviceId: string): Promise<{ key: string; ts: number }[]> {
    await this.devices.find(actor, deviceId);
    const rows = await this.db
      .select({ key: telemetryLatest.key, ts: telemetryLatest.ts })
      .from(telemetryLatest)
      .where(eq(telemetryLatest.deviceId, deviceId))
      .orderBy(asc(telemetryLatest.key));
    return rows.map((r) => ({ key: r.key, ts: r.ts.getTime() }));
  }

  /**
   * History for the requested keys. `auto` picks raw data or a continuous aggregate by range;
   * aggregates only cover numeric values, so non-numeric keys are always returned raw.
   */
  async history(actor: AuthUser, deviceId: string, q: HistoryQuery): Promise<HistoryResult> {
    const d = await this.devices.find(actor, deviceId);
    let source = q.agg === 'raw' ? 'raw' : selectSource(q.from, q.to);
    if (source === 'raw' && (q.agg === 'avg' || q.agg === 'min' || q.agg === 'max')) source = '1m';
    if (source === 'raw' && q.agg !== 'raw') {
      // Raw readings older than the profile's retention are gone; the minute summaries remain.
      const p = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, d.profileId), columns: { retentionDays: true } });
      if (p && q.from < retentionCutoff(p.retentionDays)) source = '1m';
    }

    const series: Record<string, [number, unknown][]> = Object.fromEntries(q.keys.map((k) => [k, []]));
    if (source === 'raw') {
      await this.raw(deviceId, q.keys, q, series);
      return { source, series };
    }

    const numeric = await this.numericKeys(deviceId, q.keys);
    const column = q.agg === 'min' ? 'min' : q.agg === 'max' ? 'max' : 'avg';
    if (numeric.length) {
      const view = sql.raw(AGG_VIEWS[source]);
      const res = await this.db.execute<{ key: string; bucket: Date; value: number }>(sql`
        SELECT key, bucket, ${sql.raw(column)} AS value FROM ${view}
        WHERE device_id = ${deviceId} AND key IN ${numeric}
          AND bucket >= ${new Date(q.from)} AND bucket <= ${new Date(q.to)}
        ORDER BY bucket ASC
        LIMIT ${q.limit}`);
      for (const r of res.rows) series[r.key]!.push([new Date(r.bucket).getTime(), Number(r.value)]);
    }
    const nonNumeric = q.keys.filter((k) => !numeric.includes(k));
    if (nonNumeric.length) await this.raw(deviceId, nonNumeric, q, series);
    return { source, series };
  }

  private async raw(deviceId: string, keys: string[], q: HistoryQuery, series: HistoryResult['series']) {
    const rows = await this.db
      .select()
      .from(telemetry)
      .where(
        and(
          eq(telemetry.deviceId, deviceId),
          inArray(telemetry.key, keys),
          gte(telemetry.ts, new Date(q.from)),
          lte(telemetry.ts, new Date(q.to)),
        ),
      )
      .orderBy(asc(telemetry.ts))
      .limit(q.limit);
    for (const r of rows) series[r.key]!.push([r.ts.getTime(), stored(r)]);
  }

  /** Keys whose latest value is numeric (aggregates exist only for those). */
  private async numericKeys(deviceId: string, keys: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ key: telemetryLatest.key, num: telemetryLatest.valueNum })
      .from(telemetryLatest)
      .where(and(eq(telemetryLatest.deviceId, deviceId), inArray(telemetryLatest.key, keys)));
    const known = new Map(rows.map((r) => [r.key, r.num !== null]));
    // Keys without a latest row (e.g. history imported directly) are assumed numeric.
    return keys.filter((k) => known.get(k) ?? true);
  }
}
