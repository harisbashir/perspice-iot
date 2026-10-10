import type { HistoryData } from '@perspice/shared';
import { Grid3x3 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { keyLabel, toNumber } from '../../data/format';
import { dataOf, isHistory } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';

const schema = z.object({ bucket: field.select('Bucket', ['hour', 'day']).default('hour') });
type Settings = z.infer<typeof schema>;

const BUCKET_MS = { hour: 3_600_000, day: 86_400_000 } as const;

/** Averages each key's values per time bucket: `[bucketStart, keyIndex, average]` cells. */
export function heatmapCells(data: HistoryData, keys: string[], bucketMs: number): [number, number, number][] {
  const cells: [number, number, number][] = [];
  keys.forEach((key, ki) => {
    const sums = new Map<number, { sum: number; n: number }>();
    for (const [ts, raw] of data.series[key] ?? []) {
      const v = toNumber(raw);
      if (v === null) continue;
      const b = Math.floor(ts / bucketMs) * bucketMs;
      const acc = sums.get(b) ?? { sum: 0, n: 0 };
      acc.sum += v;
      acc.n++;
      sums.set(b, acc);
    }
    for (const [b, { sum, n }] of [...sums].sort((x, y) => x[0] - y[0])) cells.push([b, ki, Math.round((sum / n) * 1000) / 1000]);
  });
  return cells;
}

export function heatmapOption(s: Settings, data: HistoryData, keys: string[], labels: Record<string, string> = {}) {
  const bucketMs = BUCKET_MS[s.bucket];
  const cells = heatmapCells(data, keys, bucketMs);
  const values = cells.map((c) => c[2]);
  const buckets = [...new Set(cells.map((c) => c[0]))].sort((a, b) => a - b);
  const fmt = (ts: number) => {
    const d = new Date(ts);
    return s.bucket === 'hour' ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00` : `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return {
    tooltip: { position: 'top' },
    grid: { left: 96, right: 16, top: 8, bottom: 56 },
    xAxis: { type: 'category', data: buckets.map(fmt) },
    yAxis: { type: 'category', data: keys.map((k) => labels[k] ?? k) },
    visualMap: { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
    series: [{ type: 'heatmap', data: cells.map(([b, k, v]) => [buckets.indexOf(b), k, v]) }],
  };
}

export const heatmap: WidgetDefinition<Settings> = {
  type: 'heatmap',
  name: 'Heatmap',
  description: 'Average of each key per hour or day across the time window.',
  icon: Grid3x3,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'history', sources: ['currentDevice', 'device'], keys: { min: 1, max: 20 } },
  defaultSize: { w: 12, h: 6 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    const option = useMemo(
      () => (isHistory(data) ? heatmapOption(settings, data, keys, Object.fromEntries(keys.map((k) => [k, keyLabel(profile, k)]))) : null),
      [data, settings, keys, profile],
    );
    return <WidgetStatus result={result}>{option && <EChart option={option} label={config.title ?? 'Heatmap'} />}</WidgetStatus>;
  },
};
