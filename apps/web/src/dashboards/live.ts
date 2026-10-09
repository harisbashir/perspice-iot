import type {
  DashboardState,
  DataRequest,
  FleetLatestData,
  HistoryData,
  LatestData,
  LatestValueDto,
  ListData,
  Timewindow,
  WidgetDataResult,
} from '@perspice/shared';
import { ENTITY_COLUMNS } from '@perspice/shared';
import { getWidget, isFleet, isHistory, isLatest, isList, isStats } from '@perspice/widgets';

export type Results = Record<string, WidgetDataResult>;
/** Per widget: the single device it shows (if any) and the telemetry keys it cares about. */
export type WidgetMeta = Record<string, { deviceId?: string; keys: string[]; stats?: 'fleet' | 'filtered' }>;
export type WidgetQuery = { page?: number; sort?: { by: string; dir: 'asc' | 'desc' }; customerId?: string };

const BUILT_IN = new Set<string>(ENTITY_COLUMNS);

/** The data API requests for a dashboard state; widgets without data (or unknown types) are skipped. */
export function buildRequests(
  state: DashboardState,
  deviceId: string | undefined,
  timewindow: Timewindow,
  queries: Record<string, WidgetQuery>,
): { requests: DataRequest[]; meta: WidgetMeta } {
  const requests: DataRequest[] = [];
  const meta: WidgetMeta = {};
  for (const w of state.widgets) {
    const def = getWidget(w.type);
    const ds = w.datasource;
    if (!def?.data.mode || ds.kind === 'none') continue;
    const q = queries[w.id] ?? {};
    requests.push({
      widgetId: w.id,
      datasource: ds,
      mode: def.data.mode,
      timewindow,
      agg: 'auto',
      page: q.page ?? 0,
      ...(q.sort ? { sort: q.sort } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
    });
    if (ds.kind === 'currentDevice' || ds.kind === 'device') {
      meta[w.id] = { deviceId: ds.kind === 'device' ? ds.deviceId : deviceId, keys: ds.keys };
    } else if (ds.kind === 'entityList') {
      meta[w.id] = { keys: ds.columns.filter((c) => !BUILT_IN.has(c)) };
    } else if (def.data.mode === 'stats') {
      // Whole-fleet counts can follow status events; filtered ones (by profile, tag…) are refetched.
      const filtered = !!(ds.profileId || ds.filter?.status?.length || ds.filter?.tags?.length || ds.filter?.search);
      meta[w.id] = { keys: ds.keys, stats: filtered ? 'filtered' : 'fleet' };
    } else {
      meta[w.id] = { keys: ds.keys };
    }
  }
  return { requests, meta };
}

export interface TelemetryEvent {
  deviceId: string;
  values: Record<string, LatestValueDto>;
}
export interface StatusEvent {
  deviceId: string;
  from: 'never' | 'online' | 'offline' | 'dead';
  to: 'never' | 'online' | 'offline' | 'dead';
  ts: number;
}

const pick = (values: Record<string, LatestValueDto>, keys: string[]) => Object.fromEntries(Object.entries(values).filter(([k]) => keys.includes(k)));

/**
 * Merges a live telemetry event into the widgets that show that device. Returns the same object
 * when nothing changed, so React can skip a render.
 */
export function applyTelemetry(results: Results, meta: WidgetMeta, e: TelemetryEvent, relativeWindow: boolean): Results {
  let changed = false;
  const out: Results = { ...results };
  for (const [id, r] of Object.entries(results)) {
    if (!r.ok || !meta[id]) continue;
    const keys = meta[id]!.keys;
    const fresh = pick(e.values, keys);
    if (!Object.keys(fresh).length) continue;
    const d = r.data;
    if (isLatest(d) && d.device.id === e.deviceId) {
      out[id] = { ok: true, data: { ...d, values: { ...d.values, ...fresh } } satisfies LatestData };
      changed = true;
    } else if (isFleet(d) && d.devices.some((x) => x.id === e.deviceId)) {
      out[id] = { ok: true, data: { devices: d.devices.map((x) => (x.id === e.deviceId ? { ...x, values: { ...x.values, ...fresh } } : x)) } satisfies FleetLatestData };
      changed = true;
    } else if (isList(d) && d.items.some((x) => x.id === e.deviceId)) {
      out[id] = { ok: true, data: { ...d, items: d.items.map((x) => (x.id === e.deviceId ? { ...x, values: { ...x.values, ...fresh } } : x)) } satisfies ListData };
      changed = true;
    } else if (isHistory(d) && relativeWindow && meta[id]!.deviceId === e.deviceId) {
      const series = { ...d.series };
      for (const [k, lv] of Object.entries(fresh)) if (series[k]) series[k] = [...series[k]!, [lv.ts, lv.v]];
      out[id] = { ok: true, data: { ...d, series } satisfies HistoryData };
      changed = true;
    }
  }
  return changed ? out : results;
}

/** Merges a status change; fleet KPI counts move from the old status to the new one. */
export function applyStatus(results: Results, e: StatusEvent, meta: WidgetMeta = {}): Results {
  let changed = false;
  const out: Results = { ...results };
  for (const [id, r] of Object.entries(results)) {
    if (!r.ok) continue;
    const d = r.data;
    if (isStats(d) && meta[id]?.stats === 'fleet' && e.from !== e.to) {
      out[id] = { ok: true, data: { ...d, [e.from]: Math.max(0, d[e.from] - 1), [e.to]: d[e.to] + 1 } };
      changed = true;
    } else if (isLatest(d) && d.device.id === e.deviceId) {
      out[id] = { ok: true, data: { ...d, device: { ...d.device, status: e.to } } };
      changed = true;
    } else if (isList(d) && d.items.some((x) => x.id === e.deviceId)) {
      out[id] = { ok: true, data: { ...d, items: d.items.map((x) => (x.id === e.deviceId ? { ...x, status: e.to } : x)) } };
      changed = true;
    } else if (isFleet(d) && d.devices.some((x) => x.id === e.deviceId)) {
      out[id] = { ok: true, data: { devices: d.devices.map((x) => (x.id === e.deviceId ? { ...x, status: e.to } : x)) } };
      changed = true;
    }
  }
  return changed ? out : results;
}

/** Every device a set of results shows, for live subscriptions. */
export function devicesIn(results: Results, meta: WidgetMeta): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(meta)) if (m.deviceId) ids.add(m.deviceId);
  for (const r of Object.values(results)) {
    if (!r.ok) continue;
    if (isList(r.data)) r.data.items.forEach((x) => ids.add(x.id));
    if (isFleet(r.data)) r.data.devices.forEach((x) => ids.add(x.id));
  }
  return [...ids];
}
