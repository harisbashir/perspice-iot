import type { FleetLatestData, LatestData } from '@perspice/shared';
import { PieChart } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { keyLabel, toNumber } from '../../data/format';
import { dataOf, isFleet, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';

const schema = z.object({ donut: field.boolean('Donut').default(true) });
type Settings = z.infer<typeof schema>;

export function pieOption(s: Settings, data: LatestData | FleetLatestData, keys: string[], labels: Record<string, string> = {}) {
  const slices = isFleet(data)
    ? data.devices.map((d) => ({ name: d.name, value: toNumber(d.values[keys[0] ?? '']?.v) ?? 0 }))
    : keys.map((k) => ({ name: labels[k] ?? k, value: toNumber((data as LatestData).values[k]?.v) ?? 0 }));
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [{ type: 'pie', radius: s.donut ? ['45%', '70%'] : '70%', itemStyle: { borderColor: 'rgba(128,128,128,0.15)', borderWidth: 1, borderRadius: s.donut ? 4 : 0 }, data: slices }],
  };
}

export const pieChart: WidgetDefinition<Settings> = {
  type: 'pie-chart',
  name: 'Pie / donut',
  description: 'Share of each key (one device) or of each device (a group) in a value.',
  icon: PieChart,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device', 'devicesOfProfile', 'currentAsset'], keys: { min: 1, max: 20 } },
  defaultSize: { w: 4, h: 6 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    const option = useMemo(() => {
      if (!isLatest(data) && !isFleet(data)) return null;
      return pieOption(settings, data, keys, Object.fromEntries(keys.map((k) => [k, keyLabel(profile, k)])));
    }, [data, settings, keys, profile]);
    return <WidgetStatus result={result}>{option && <EChart option={option} label={config.title ?? 'Pie chart'} />}</WidgetStatus>;
  },
};
