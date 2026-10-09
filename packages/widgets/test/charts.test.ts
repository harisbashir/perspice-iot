import type { HistoryData, LatestData, FleetLatestData } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { barOption } from '../src/library/charts/bar';
import { gaugeOption } from '../src/library/charts/radial-gauge';
import { heatmapCells, heatmapOption } from '../src/library/charts/heatmap';
import { linearGaugeModel } from '../src/library/charts/linear-gauge';
import { lineOption } from '../src/library/charts/line';
import { pieOption } from '../src/library/charts/pie';
import { sparklineModel } from '../src/library/charts/sparkline';
import { CHART_WIDGETS } from '../src/library/charts';

const H = 3_600_000;
const history: HistoryData = {
  source: 'raw',
  series: {
    fuel_level: [
      [0, 10],
      [H, 20],
    ],
    batt_v: [
      [0, 50],
      [H, 51],
    ],
  },
};
const device = { id: 'd1', name: 'Tower 17', status: 'online' as const, lastSeen: 1, profileId: 'p', customerId: null };
const latest: LatestData = { device, values: { fuel_level: { ts: 1, v: 64.5 }, batt_v: { ts: 1, v: 52 } } };
const fleet: FleetLatestData = {
  devices: [
    { ...device, id: 'a', name: 'A', values: { fuel_level: { ts: 1, v: 30 } } },
    { ...device, id: 'b', name: 'B', values: { fuel_level: { ts: 1, v: 70 } } },
  ],
};

describe('chart widgets', () => {
  it('every chart has defaults for all settings', () => {
    for (const w of CHART_WIDGETS) expect(() => w.settingsSchema.parse({})).not.toThrow();
  });

  it('line chart: one series per key, optional second axis and area', () => {
    const opt = lineOption({ area: true, smooth: false, rightAxisKey: 'batt_v' }, history, { fuel_level: 'Fuel (%)' });
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0]).toMatchObject({ name: 'Fuel (%)', type: 'line', yAxisIndex: 0, areaStyle: {} });
    expect(opt.series[1]).toMatchObject({ name: 'batt_v', yAxisIndex: 1 });
    expect(opt.yAxis).toHaveLength(2);
  });

  it('bar chart: bars per key for one device, per device for a fleet', () => {
    expect(barOption({ horizontal: false }, latest, ['fuel_level', 'batt_v']).series[0]!.data).toEqual([64.5, 52]);
    const perDevice = barOption({ horizontal: true }, fleet, ['fuel_level']);
    expect(perDevice.yAxis).toMatchObject({ type: 'category', data: ['A', 'B'] });
    expect(perDevice.series[0]!.data).toEqual([30, 70]);
  });

  it('pie chart: slices per key or per device, donut radius', () => {
    const pie = pieOption({ donut: true }, latest, ['fuel_level', 'batt_v']);
    expect(pie.series[0]!.radius).toEqual(['45%', '70%']);
    expect(pie.series[0]!.data).toEqual([
      { name: 'fuel_level', value: 64.5 },
      { name: 'batt_v', value: 52 },
    ]);
    expect(pieOption({ donut: false }, fleet, ['fuel_level']).series[0]!.data).toHaveLength(2);
  });

  it('radial gauge clamps to its range and colours thresholds', () => {
    const opt = gaugeOption({ min: 0, max: 100, decimals: 1, unit: '%', warnAt: 30, critAt: 10, lowIsBad: true }, 150);
    expect(opt.series[0]!.data[0]!.value).toBe(100);
    expect(opt.series[0]!.min).toBe(0);
    expect(gaugeOption({ min: 0, max: 100, decimals: 0, unit: '', lowIsBad: false }, -5).series[0]!.data[0]!.value).toBe(0);
  });

  it('linear gauge computes the filled fraction and band', () => {
    expect(linearGaugeModel({ min: 0, max: 200, warnAt: 150, critAt: 180, lowIsBad: false, decimals: 0, unit: 'V' }, 160)).toMatchObject({
      fraction: 0.8,
      band: 'warn',
      text: '160 V',
    });
    expect(linearGaugeModel({ min: 0, max: 100, decimals: 0, unit: '', lowIsBad: false }, null)).toMatchObject({ fraction: 0, text: '—' });
  });

  it('heatmap buckets values by hour and key', () => {
    const cells = heatmapCells(
      {
        source: 'raw',
        series: {
          t: [
            [0, 1],
            [60_000, 3],
            [H + 1, 10],
          ],
        },
      },
      ['t'],
      H,
    );
    expect(cells).toEqual([
      [0, 0, 2],
      [H, 0, 10],
    ]);
    const opt = heatmapOption({ bucket: 'hour' }, history, ['fuel_level', 'batt_v']);
    expect(opt.yAxis).toMatchObject({ data: ['fuel_level', 'batt_v'] });
    expect(opt.visualMap).toMatchObject({ min: 10, max: 51 });
  });

  it('sparkline reports the last value and the change', () => {
    expect(sparklineModel(history, 'fuel_level')).toMatchObject({ last: 20, delta: 10, points: [10, 20] });
    expect(sparklineModel({ source: 'raw', series: {} }, 'x')).toMatchObject({ last: null, points: [] });
  });
});
