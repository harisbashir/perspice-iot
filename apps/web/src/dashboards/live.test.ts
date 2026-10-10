import type { DashboardState, HistoryData, LatestData, ListData, LocationsData } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { dataOf, registerBuiltInWidgets } from '@perspice/widgets';
import { applyLocation, applyStatus, applyTelemetry, buildRequests, devicesIn } from './live';

registerBuiltInWidgets();

const device = { id: 'd1', name: 'Tower', status: 'online' as const, lastSeen: 1, profileId: 'p', customerId: null };

const state: DashboardState = {
  id: 'main',
  name: 'Main',
  layout: [
    { i: 'card', x: 0, y: 0, w: 3, h: 3 },
    { i: 'chart', x: 3, y: 0, w: 6, h: 6 },
    { i: 'table', x: 0, y: 6, w: 12, h: 6 },
    { i: 'note', x: 9, y: 0, w: 3, h: 3 },
    { i: 'mystery', x: 0, y: 12, w: 3, h: 3 },
  ],
  widgets: [
    { id: 'card', type: 'value-card', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} },
    { id: 'chart', type: 'line-chart', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} },
    { id: 'table', type: 'entity-table', datasource: { kind: 'entityList', profileId: null, columns: ['name', 'fuel_level'], pageSize: 25 }, settings: {} },
    { id: 'note', type: 'markdown', datasource: { kind: 'none' }, settings: {} },
    { id: 'mystery', type: 'future-widget', datasource: { kind: 'currentDevice', keys: ['x'] }, settings: {} },
  ],
};

describe('buildRequests', () => {
  it('asks each known widget for its mode and skips widgets without data', () => {
    const { requests, meta } = buildRequests(state, 'd1', { kind: 'relative', lastMs: 3_600_000 }, { table: { page: 2 } });
    expect(requests.map((r) => [r.widgetId, r.mode])).toEqual([
      ['card', 'latest'],
      ['chart', 'history'],
      ['table', 'list'],
    ]);
    expect(requests.find((r) => r.widgetId === 'table')).toMatchObject({ page: 2 });
    expect(meta.card).toEqual({ deviceId: 'd1', keys: ['fuel_level'] });
    expect(meta.table).toEqual({ keys: ['fuel_level'] });
  });
});

describe('live updates', () => {
  const now = 10_000;
  const base = () => ({
    card: { ok: true as const, data: { device, values: { fuel_level: { ts: 1, v: 10 } } } satisfies LatestData },
    chart: { ok: true as const, data: { source: 'raw', series: { fuel_level: [[1, 10]] } } satisfies HistoryData },
    table: {
      ok: true as const,
      data: { items: [{ ...device, profileName: 'P', customerName: null, values: {} }], total: 1, page: 0, pageSize: 25 } satisfies ListData,
    },
  });
  const meta = { card: { deviceId: 'd1', keys: ['fuel_level'] }, chart: { deviceId: 'd1', keys: ['fuel_level'] }, table: { keys: ['fuel_level'] } };

  it('merges new values for the keys each widget shows', () => {
    const out = applyTelemetry(base(), meta, { deviceId: 'd1', values: { fuel_level: { ts: now, v: 20 }, other: { ts: now, v: 1 } } }, true);
    expect((dataOf(out.card) as LatestData).values).toEqual({ fuel_level: { ts: now, v: 20 } });
    expect((dataOf(out.chart) as HistoryData).series.fuel_level).toEqual([
      [1, 10],
      [now, 20],
    ]);
    expect((dataOf(out.table) as ListData).items[0]!.values).toEqual({ fuel_level: { ts: now, v: 20 } });
  });

  it('leaves history alone for absolute windows and ignores other devices', () => {
    const out = applyTelemetry(base(), meta, { deviceId: 'd1', values: { fuel_level: { ts: now, v: 20 } } }, false);
    expect((dataOf(out.chart) as HistoryData).series.fuel_level).toHaveLength(1);
    const same = base();
    expect(applyTelemetry(same, meta, { deviceId: 'zzz', values: { fuel_level: { ts: now, v: 5 } } }, true)).toBe(same);
  });

  it('updates device status in latest and list results', () => {
    const out = applyStatus(base(), { deviceId: 'd1', from: 'online', to: 'offline', ts: now });
    expect((dataOf(out.card) as LatestData).device.status).toBe('offline');
    expect((dataOf(out.table) as ListData).items[0]!.status).toBe('offline');
  });
});

describe('KPI tiles', () => {
  const kpiState = (filter?: { status: ('online' | 'offline')[] }): DashboardState => ({
    id: 's',
    name: 'S',
    layout: [{ i: 'k', x: 0, y: 0, w: 2, h: 2 }],
    widgets: [{ id: 'k', type: 'kpi', datasource: { kind: 'devicesOfProfile', profileId: null, keys: [], ...(filter ? { filter } : {}) }, settings: {} }],
  });
  const stats = { total: 3, online: 1, offline: 2, dead: 0, never: 0, messages24h: 7 };

  it('moves fleet counts on a status change and leaves filtered KPIs to a refetch', () => {
    const fleet = buildRequests(kpiState(), undefined, { kind: 'relative', lastMs: 1 }, {}).meta;
    expect(fleet.k?.stats).toBe('fleet');
    const out = applyStatus({ k: { ok: true, data: stats } }, { deviceId: 'x', from: 'offline', to: 'online', ts: 1 }, fleet);
    expect(out.k).toEqual({ ok: true, data: { ...stats, online: 2, offline: 1 } });

    const filtered = buildRequests(kpiState({ status: ['online'] }), undefined, { kind: 'relative', lastMs: 1 }, {}).meta;
    expect(filtered.k?.stats).toBe('filtered');
    const same = { k: { ok: true as const, data: stats } };
    expect(applyStatus(same, { deviceId: 'x', from: 'offline', to: 'online', ts: 1 }, filtered)).toBe(same);
  });

  it('passes the customer filter of an entity list through', () => {
    const state: DashboardState = {
      id: 's',
      name: 'S',
      layout: [{ i: 't', x: 0, y: 0, w: 12, h: 6 }],
      widgets: [{ id: 't', type: 'entity-table', datasource: { kind: 'entityList', profileId: null, columns: ['name'], pageSize: 25 }, settings: {} }],
    };
    const { requests } = buildRequests(state, undefined, { kind: 'relative', lastMs: 1 }, { t: { customerId: 'c1', page: 0 } });
    expect(requests[0]).toMatchObject({ customerId: 'c1', page: 0 });
  });
});

describe('alarm sources', () => {
  it('requests alarm lists and marks them for live refetching', () => {
    const state: DashboardState = {
      id: 's',
      name: 'S',
      layout: [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }],
      widgets: [{ id: 'a', type: 'alarm-table', datasource: { kind: 'alarms', filter: { status: ['active'] }, pageSize: 5 }, settings: {} }],
    };
    const { requests, meta } = buildRequests(state, 'd1', { kind: 'relative', lastMs: 60_000 }, {});
    expect(requests[0]).toMatchObject({ widgetId: 'a', mode: 'list', datasource: { kind: 'alarms' } });
    expect(meta.a).toEqual({ keys: [], alarms: true });
  });
});

describe('map widgets', () => {
  const loc = (lat: number) => ({ lat, lng: -0.12, ts: 1, source: 'reported' as const });
  const results = () => ({
    map: { ok: true as const, data: { truncated: false, devices: [{ ...device, location: loc(51.5), values: {} }] } satisfies LocationsData },
  });
  const meta = { map: { keys: ['fuel_level'], locations: true } };

  it('moves a device when a newer location arrives, and ignores older ones', () => {
    const moved = applyLocation(results(), { deviceId: 'd1', location: { ...loc(51.6), ts: 5 } });
    expect((dataOf(moved.map) as LocationsData).devices[0]!.location.lat).toBe(51.6);
    const r = results();
    expect(applyLocation(r, { deviceId: 'd1', location: { ...loc(40), ts: 0 } })).toBe(r);
    expect(applyLocation(r, { deviceId: 'other', location: loc(40) })).toBe(r);
  });

  it('follows status and popup values, and subscribes to the devices shown', () => {
    const s = applyStatus(results(), { deviceId: 'd1', from: 'online', to: 'offline', ts: 2 }, meta);
    expect((dataOf(s.map) as LocationsData).devices[0]!.status).toBe('offline');
    const v = applyTelemetry(results(), meta, { deviceId: 'd1', values: { fuel_level: { ts: 2, v: 12 } } }, true);
    expect((dataOf(v.map) as LocationsData).devices[0]!.values.fuel_level?.v).toBe(12);
    expect(devicesIn(results(), meta)).toEqual(['d1']);
  });
});
