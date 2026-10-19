import type { FleetLatestData, LatestData } from '@perspice/shared';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { keyLabel, toNumber } from '../../data/format';
import { dataOf, isFleet, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';

const schema = z.object({ horizontal: field.boolean('Horizontal bars').default(false) });
type Settings = z.infer<typeof schema>;

/** One device: a bar per key. Several devices: a bar per device for the first key. */
export function barOption(s: Settings, data: LatestData | FleetLatestData, keys: string[], labels: Record<string, string> = {}) {
  const categories = isFleet(data) ? data.devices.map((d) => d.name) : keys.map((k) => labels[k] ?? k);
  const values = isFleet(data)
    ? data.devices.map((d) => toNumber(d.values[keys[0] ?? '']?.v))
    : keys.map((k) => toNumber((data as LatestData).values[k]?.v));
  const category = { type: 'category', data: categories };
  const value = { type: 'value' };
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
    xAxis: s.horizontal ? value : category,
    yAxis: s.horizontal ? category : value,
    series: [{ type: 'bar', name: labels[keys[0] ?? ''] ?? keys[0], data: values }],
  };
}

export const barChart: WidgetDefinition<Settings> = {
  type: 'bar-chart',
  name: 'Bar chart',
  description: 'Latest values as bars: per key for one device, or per device for a group.',
  icon: BarChart3,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device', 'devicesOfProfile', 'currentAsset'], keys: { min: 1, max: 20 } },
  defaultSize: { w: 6, h: 6 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    const option = useMemo(() => {
      if (!isLatest(data) && !isFleet(data)) return null;
      return barOption(settings, data, keys, Object.fromEntries(keys.map((k) => [k, keyLabel(profile, k)])));
    }, [data, settings, keys, profile]);
    return <WidgetStatus result={result}>{option && <EChart option={option} label={config.title ?? 'Bar chart'} />}</WidgetStatus>;
  },
};
