import type { DataRequest, EnergyData, FleetLatestData, HistoryData, LatestData, ListData, LocationsData, StatsData, TelemetryKeyDef } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { isSampled, sampleResult } from './sample-data';

const NOW = Date.UTC(2026, 9, 14, 12);
const keys: TelemetryKeyDef[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', type: 'number', decimals: 1 },
  { key: 'door', label: 'Door', type: 'boolean' },
  { key: 'mode', label: 'Mode', type: 'string' },
  { key: 'energy', label: 'Energy', unit: 'kWh', type: 'number' },
];
const req = (datasource: DataRequest['datasource'], mode: DataRequest['mode'], extra: Partial<DataRequest> = {}): DataRequest => ({
  widgetId: 'w1',
  datasource,
  mode,
  timewindow: { kind: 'relative', lastMs: 86_400_000 },
  agg: 'auto',
  energyRange: 'window',
  page: 0,
  ...extra,
});
const data = <T,>(r: ReturnType<typeof sampleResult>) => {
  if (!r.ok) throw new Error(r.message);
  return r.data as T;
};

describe('sample data for template previews', () => {
  it('stands in only for the dashboard’s own device or asset', () => {
    expect(isSampled({ kind: 'currentDevice', keys: [] })).toBe(true);
    expect(isSampled({ kind: 'currentAsset', profileId: null, filter: {}, keys: [], depth: 'subtree' } as never)).toBe(true);
    expect(isSampled({ kind: 'devicesOfProfile', profileId: null, filter: {}, keys: [] })).toBe(false);
    expect(isSampled({ kind: 'none' })).toBe(false);
  });

  it('gives each key a value of its type, the same on every render', () => {
    const r = req({ kind: 'currentDevice', keys: ['temperature', 'door', 'mode', 'unknown'] }, 'latest');
    const latest = data<LatestData>(sampleResult(r, keys, NOW));
    expect(latest.device.status).toBe('online');
    expect(typeof latest.values.temperature!.v).toBe('number');
    expect(typeof latest.values.door!.v).toBe('boolean');
    expect(typeof latest.values.mode!.v).toBe('string');
    expect(typeof latest.values.unknown!.v).toBe('number');
    expect(sampleResult(r, keys, NOW)).toEqual(sampleResult(r, keys, NOW));
  });

  it('draws history across the timewindow', () => {
    const history = data<HistoryData>(sampleResult(req({ kind: 'currentDevice', keys: ['temperature'] }, 'history'), keys, NOW));
    const points = history.series.temperature!;
    expect(points.length).toBeGreaterThan(20);
    expect(points[0]![0]).toBeGreaterThanOrEqual(NOW - 86_400_000);
    expect(points.at(-1)![0]).toBeLessThanOrEqual(NOW);
    expect(new Set(points.map((p) => p[1])).size).toBeGreaterThan(1);
  });

  it('places the device on the map, sums energy into periods, and fills asset widgets with a few devices', () => {
    const located = data<LocationsData>(sampleResult(req({ kind: 'currentDevice', keys: [] }, 'locations'), keys, NOW));
    expect(located.devices).toHaveLength(1);
    expect(located.devices[0]!.location).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });

    const energy = data<EnergyData>(sampleResult(req({ kind: 'currentDevice', keys: ['energy'] }, 'energy'), keys, NOW));
    expect(energy).toMatchObject({ key: 'energy', unit: 'kWh', period: 'hour' });
    expect(energy.periods.length).toBeGreaterThan(1);
    expect(energy.total.consumption).toBeCloseTo(energy.periods.reduce((s, p) => s + p.consumption, 0), 3);

    const asset = { kind: 'currentAsset', profileId: null, filter: {}, keys: ['temperature'], depth: 'subtree' } as never;
    const stats = data<StatsData>(sampleResult(req(asset, 'stats'), keys, NOW));
    expect(stats.online + stats.offline + stats.dead + stats.never).toBe(stats.total);
    expect(data<FleetLatestData>(sampleResult(req(asset, 'latest'), keys, NOW)).devices.length).toBeGreaterThan(1);
    const list = data<ListData>(sampleResult(req(asset, 'list'), keys, NOW));
    expect(list.total).toBe(list.items.length);
    expect(data<LocationsData>(sampleResult(req(asset, 'locations'), keys, NOW)).devices.length).toBeGreaterThan(1);
  });
});
