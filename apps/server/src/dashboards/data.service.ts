import { AssetsService } from '../assets/assets.service';
import { EnergyService } from '../energy/energy.service';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AlarmListData,
  type AlarmStatsData,
  type DataRequest,
  type DataSource,
  type DeviceSummary,
  ENTITY_COLUMNS,
  type FleetLatestData,
  type HistoryData,
  type LatestData,
  type ListData,
  type LocationsData,
  MAX_DASHBOARD_DEVICES,
  MAX_MAP_DEVICES,
  type StatsData,
  type Timewindow,
  type WidgetDataResult,
  type Permission,
} from '@perspice/shared';
import { type SQL, and, arrayContains, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError, forbidden, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { scoped } from '../db/scoped-repo';
import { customer, device, deviceProfile, telemetryLatest } from '../db/schema';
import { AlarmsService } from '../alarms/alarms.service';
import { DevicesService } from '../devices/devices.service';
import { type Scope, ScopeService } from '../rbac/scope';
import { TelemetryService } from '../telemetry/telemetry.service';

type DeviceRow = typeof device.$inferSelect;
type Filter = Extract<DataSource, { kind: 'entityList' }>['filter'];

const DAY_MS = 86_400_000;
/** Matches no device: "this device only" on a dashboard that has none. */
const NO_DEVICE = '00000000-0000-0000-0000-000000000000';
const BUILT_IN = new Set<string>(ENTITY_COLUMNS);

const summary = (d: DeviceRow, lastSeen: number | null): DeviceSummary => ({
  id: d.id,
  name: d.name,
  status: d.status,
  lastSeen,
  profileId: d.profileId,
  customerId: d.customerId,
});

const pick = <T>(values: Record<string, T> | undefined, keys: string[]): Record<string, T> =>
  Object.fromEntries(Object.entries(values ?? {}).filter(([k]) => keys.includes(k)));

/**
 * Each widget needs the permissions its data would need through the API (scope alone isn't enough
 * for custom roles): device sources need device.read (asset sources also asset.read), values of any
 * kind telemetry.read, alarm sources alarm.read. Device counts need only device.read.
 */
function requirePermissions(actor: AuthUser, r: DataRequest): void {
  const ds = r.datasource;
  const need: Permission[] = [];
  if (ds.kind === 'alarms') need.push('alarm.read');
  else if (ds.kind !== 'none') {
    need.push('device.read');
    if (ds.kind === 'currentAsset') need.push('asset.read');
    const keys = ds.kind === 'entityList' ? ds.columns.filter((c) => !(ENTITY_COLUMNS as readonly string[]).includes(c)) : ds.keys;
    const showsValues = r.mode === 'history' || r.mode === 'energy' || r.mode === 'latest' || r.mode === 'locations' || (r.mode === 'list' && keys.length > 0);
    if (showsValues) need.push('telemetry.read');
  }
  const missing = need.filter((p) => !actor.permissions.includes(p));
  if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
}

export function windowOf(tw: Timewindow | undefined, now = Date.now()): { from: number; to: number } {
  if (!tw) return { from: now - DAY_MS, to: now };
  return tw.kind === 'relative' ? { from: now - tw.lastMs, to: now } : { from: tw.fromMs, to: tw.toMs };
}

/**
 * Resolves widget data sources for one dashboard in a single round trip. Every source is
 * constrained to the viewer's scope; a failing widget reports its own error (Review Focus 1).
 */
@Injectable()
export class DataService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly devices: DevicesService,
    private readonly scopes: ScopeService,
    private readonly telemetry: TelemetryService,
    private readonly alarms: AlarmsService,
    private readonly energy: EnergyService,
    private readonly assets: AssetsService,
  ) {}

  async query(actor: AuthUser, deviceId: string | undefined, requests: DataRequest[], assetId?: string): Promise<Record<string, WidgetDataResult>> {
    const scope = await this.scopes.forUser(actor);
    const entries = await Promise.all(
      requests.map(async (r): Promise<[string, WidgetDataResult]> => {
        try {
          return [r.widgetId, { ok: true, data: await this.resolve(actor, scope, deviceId, r, assetId) }];
        } catch (err) {
          if (err instanceof AppError) return [r.widgetId, { ok: false, code: err.code, message: err.message }];
          throw err;
        }
      }),
    );
    return Object.fromEntries(entries);
  }

  private async resolve(actor: AuthUser, scope: Scope, deviceId: string | undefined, r: DataRequest, assetId?: string): Promise<unknown> {
    const ds = r.datasource;
    requirePermissions(actor, r);
    switch (ds.kind) {
      case 'none':
        return null;
      case 'currentDevice':
      case 'device': {
        const id = ds.kind === 'device' ? ds.deviceId : deviceId;
        if (!id) throw validation([], 'This widget needs the dashboard to be opened for a device');
        if (r.mode === 'latest') return this.latestOne(actor, id, ds.keys);
        if (r.mode === 'history') return this.history(actor, id, ds.keys, r);
        if (r.mode === 'locations') return this.locations([await this.devices.find(actor, id)], ds.keys, false);
        if (r.mode === 'energy') return this.energy.summary(actor, id, ds.keys[0], r.energyRange, windowOf(r.timewindow));
        throw validation([], `Mode "${r.mode}" does not apply to a single device`);
      }
      case 'currentAsset': {
        if (!assetId) throw validation([], 'This widget needs the dashboard to be opened for an asset');
        const a = await this.assets.find(actor, assetId); // scope: 404 outside it
        const ids = await this.assets.deviceIds(a.id, ds.depth, scope);
        const onAsset = ids.length ? inArray(device.id, ids) : sql`false`;
        if (r.mode === 'stats') return this.stats(scope, ds.profileId, ds.filter, onAsset);
        if (r.mode === 'latest') return this.latestMany(scope, ds.profileId, ds.filter, ds.keys, onAsset);
        if (r.mode === 'locations') return this.locatedIn(this.conditions(scope, ds.profileId, ds.filter, onAsset), ds.keys);
        if (r.mode === 'list') {
          const columns = ['name', 'status', 'lastSeen', ...ds.keys];
          return this.list(scope, { kind: 'entityList', profileId: ds.profileId, filter: ds.filter, columns, pageSize: 25 }, r, onAsset);
        }
        if (r.mode === 'energy') return this.energy.summaryForDevices(a.customerId, ids, ds.keys[0], r.energyRange, windowOf(r.timewindow));
        throw validation([], `Mode "${r.mode}" does not apply to an asset`);
      }
      case 'devicesOfProfile':
        if (r.mode === 'stats') return this.stats(scope, ds.profileId, ds.filter);
        if (r.mode === 'latest') return this.latestMany(scope, ds.profileId, ds.filter, ds.keys);
        if (r.mode === 'locations') return this.locatedIn(this.conditions(scope, ds.profileId, ds.filter), ds.keys);
        throw validation([], `Mode "${r.mode}" does not apply to a device group`);
      case 'entityList': {
        if (r.mode === 'list') return this.list(scope, ds, r);
        const where = this.conditions(scope, ds.profileId, ds.filter);
        const keys = ds.columns.filter((c) => !(ENTITY_COLUMNS as readonly string[]).includes(c));
        if (r.mode === 'locations') return this.locatedIn(r.customerId ? and(where, eq(device.customerId, r.customerId)) : where, keys);
        throw validation([], 'Entity lists support modes "list" and "locations"');
      }
      case 'alarms': {
        const f = {
          status: ds.filter.status,
          severity: ds.filter.severity,
          profileId: ds.filter.profileId ?? undefined,
          deviceId: ds.filter.currentDeviceOnly ? (deviceId ?? NO_DEVICE) : undefined,
          assetId: ds.filter.currentAssetOnly ? (assetId ?? NO_DEVICE) : undefined,
        };
        if (r.mode === 'stats') return (await this.alarms.summary(actor, f)) satisfies AlarmStatsData;
        if (r.mode === 'list') {
          const [{ items }, total] = await Promise.all([this.alarms.list(actor, f, undefined, ds.pageSize), this.alarms.count(actor, f)]);
          return { alarms: items, total } satisfies AlarmListData;
        }
        throw validation([], 'Alarm sources support modes "list" and "stats"');
      }
    }
  }

  private async latestOne(actor: AuthUser, id: string, keys: string[]): Promise<LatestData> {
    const row = await this.devices.find(actor, id); // scope check: 404 when out of scope
    const [dto] = await this.devices.toDtos([row]);
    return { device: summary(row, dto!.lastSeen), values: pick(dto!.latest, keys) };
  }

  private history(actor: AuthUser, id: string, keys: string[], r: DataRequest): Promise<HistoryData> {
    if (!keys.length) throw validation([], 'Choose at least one key');
    const { from, to } = windowOf(r.timewindow);
    return this.telemetry.history(actor, id, { keys, from, to, agg: r.agg, limit: 10_000 });
  }

  private conditions(scope: Scope, profileId: string | null, filter: Filter, extra?: SQL): SQL | undefined {
    const conds: (SQL | undefined)[] = [
      extra,
      profileId ? eq(device.profileId, profileId) : undefined,
      filter?.status?.length ? inArray(device.status, filter.status) : undefined,
      filter?.tags?.length ? arrayContains(device.tags, filter.tags) : undefined,
      filter?.search ? ilike(device.name, `%${filter.search}%`) : undefined,
    ];
    return scoped(device, scope, ...conds);
  }

  /** Devices with a location (stored, or reported and still in Redis), for maps. */
  private async locatedIn(where: SQL | undefined, keys: string[]): Promise<LocationsData> {
    const rows = await this.db.select().from(device).where(where).orderBy(asc(device.name)).limit(MAX_MAP_DEVICES + 1);
    return this.locations(rows.slice(0, MAX_MAP_DEVICES), keys, rows.length > MAX_MAP_DEVICES);
  }

  private async locations(rows: (typeof device.$inferSelect)[], keys: string[], truncated: boolean): Promise<LocationsData> {
    const dtos = await this.devices.toDtos(rows);
    const devices = rows.flatMap((d, i) => {
      const dto = dtos[i]!;
      return dto.location ? [{ ...summary(d, dto.lastSeen), location: dto.location, values: pick(dto.latest, keys) }] : [];
    });
    return { devices, truncated };
  }

  private async latestMany(scope: Scope, profileId: string | null, filter: Filter, keys: string[], extra?: SQL): Promise<FleetLatestData> {
    const rows = await this.db
      .select()
      .from(device)
      .where(this.conditions(scope, profileId, filter, extra))
      .orderBy(asc(device.name))
      .limit(MAX_DASHBOARD_DEVICES);
    const dtos = await this.devices.toDtos(rows);
    return { devices: rows.map((d, i) => ({ ...summary(d, dtos[i]!.lastSeen), values: pick(dtos[i]!.latest, keys) })) };
  }

  private async list(scope: Scope, ds: Extract<DataSource, { kind: 'entityList' }>, r: DataRequest, extra?: SQL): Promise<ListData> {
    const unfiltered = this.conditions(scope, ds.profileId, ds.filter, extra);
    const where = r.customerId ? and(unfiltered, eq(device.customerId, r.customerId)) : unfiltered;
    const [{ total } = { total: 0 }] = await this.db.select({ total: count() }).from(device).where(where);

    const dir = r.sort?.dir === 'desc' ? desc : asc;
    const by = r.sort?.by ?? 'name';
    let order: SQL[];
    let base = this.db
      .select({ d: device, profileName: deviceProfile.name, customerName: customer.name })
      .from(device)
      .innerJoin(deviceProfile, eq(deviceProfile.id, device.profileId))
      .leftJoin(customer, eq(customer.id, device.customerId))
      .$dynamic();
    if (by === 'name' || by === 'status' || by === 'lastSeen' || by === 'profile' || by === 'customer') {
      const col = { name: device.name, status: device.status, lastSeen: device.lastSeen, profile: deviceProfile.name, customer: customer.name }[by];
      order = [sql`${dir(col)} NULLS LAST`, asc(device.id)];
    } else {
      // Sorting by a telemetry key uses the stored latest value.
      base = base.leftJoin(telemetryLatest, and(eq(telemetryLatest.deviceId, device.id), eq(telemetryLatest.key, by)));
      order = [
        sql`${dir(telemetryLatest.valueNum)} NULLS LAST`,
        sql`${dir(telemetryLatest.valueStr)} NULLS LAST`,
        asc(device.name),
      ];
    }
    const rows = await base
      .where(where)
      .orderBy(...order)
      .limit(ds.pageSize)
      .offset(r.page * ds.pageSize);
    const dtos = await this.devices.toDtos(rows.map((x) => x.d));
    const keys = ds.columns.filter((c) => !BUILT_IN.has(c));
    return {
      items: rows.map((x, i) => ({
        ...summary(x.d, dtos[i]!.lastSeen),
        profileName: x.profileName,
        customerName: x.customerName,
        values: pick(dtos[i]!.latest, keys),
      })),
      total,
      page: r.page,
      pageSize: ds.pageSize,
      ...(scope.kind === 'platform' ? { customers: await this.customersOf(unfiltered) } : {}),
    };
  }

  private async customersOf(where: SQL | undefined): Promise<{ id: string; name: string }[]> {
    return this.db
      .selectDistinct({ id: customer.id, name: customer.name })
      .from(device)
      .innerJoin(customer, eq(customer.id, device.customerId))
      .where(where)
      .orderBy(customer.name)
      .limit(500);
  }

  private async stats(scope: Scope, profileId: string | null, filter: Filter, extra?: SQL): Promise<StatsData> {
    const where = this.conditions(scope, profileId, filter, extra);
    const rows = await this.db.select({ status: device.status, n: count() }).from(device).where(where).groupBy(device.status);
    const out: StatsData = { total: 0, online: 0, offline: 0, dead: 0, never: 0, messages24h: 0 };
    for (const r of rows) {
      out[r.status] = r.n;
      out.total += r.n;
    }
    // Values received in the last 24 h, from the hourly aggregate (real-time, numeric values).
    const ids = this.db.select({ id: device.id }).from(device).where(where);
    const res = await this.db.execute<{ n: string | null }>(sql`
      SELECT sum(count)::bigint AS n FROM telemetry_1h
      WHERE bucket >= ${new Date(Date.now() - DAY_MS - 3_600_000)} AND device_id IN (${ids})`);
    out.messages24h = Number(res.rows[0]?.n ?? 0);
    return out;
  }
}

