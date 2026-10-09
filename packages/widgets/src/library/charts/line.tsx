import type { HistoryData } from '@perspice/shared';
import { LineChart } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { keyLabel } from '../../data/format';
import { dataOf, isHistory } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';

const schema = z.object({
  area: field.boolean('Fill area').default(false),
  smooth: field.boolean('Smooth lines').default(false),
  rightAxisKey: field.key('Key on the right axis', 'Optional second y-axis').optional(),
});
type Settings = z.infer<typeof schema>;

export function lineOption(s: Settings, data: HistoryData, labels: Record<string, string> = {}) {
  const keys = Object.keys(data.series);
  const right = s.rightAxisKey && keys.includes(s.rightAxisKey) ? s.rightAxisKey : undefined;
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, type: 'scroll' },
    grid: { left: 48, right: right ? 48 : 16, top: 32, bottom: 32 },
    xAxis: { type: 'time' },
    yAxis: right ? [{ type: 'value', scale: true }, { type: 'value', scale: true }] : [{ type: 'value', scale: true }],
    series: keys.map((k) => ({
      name: labels[k] ?? k,
      type: 'line',
      showSymbol: false,
      smooth: s.smooth,
      yAxisIndex: k === right ? 1 : 0,
      ...(s.area ? { areaStyle: {} } : {}),
      data: data.series[k]!,
    })),
  };
}

export const lineChart: WidgetDefinition<Settings> = {
  type: 'line-chart',
  name: 'Time series',
  description: 'Line or area chart of one or more keys over the dashboard time window.',
  icon: LineChart,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'history', sources: ['currentDevice', 'device'], keys: { min: 1, max: 10 } },
  defaultSize: { w: 8, h: 6 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const option = useMemo(() => {
      if (!isHistory(data)) return null;
      const labels = Object.fromEntries(Object.keys(data.series).map((k) => [k, keyLabel(profile, k)]));
      return lineOption(settings, data, labels);
    }, [data, settings, profile]);
    const empty = !!option && option.series.every((s) => s.data.length === 0);
    return (
      <WidgetStatus result={result} empty={empty}>
        {option && <EChart option={option} label={config.title ?? 'Time series chart'} />}
      </WidgetStatus>
    );
  },
};
