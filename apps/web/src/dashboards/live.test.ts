import type { DashboardState, HistoryData, LatestData, ListData } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { dataOf, registerBuiltInWidgets } from '@perspice/widgets';
import { applyStatus, applyTelemetry, buildRequests } from './live';

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
