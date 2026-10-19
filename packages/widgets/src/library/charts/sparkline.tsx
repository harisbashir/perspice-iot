import type { HistoryData } from '@perspice/shared';
import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { formatNumber, keyDef, toNumber } from '../../data/format';
import { dataOf, isHistory } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';
import { Readout, splitUnit } from '../shared/Readout';

const schema = z.object({ color: field.color('Line colour').default('#0A84FF') });
type Settings = z.infer<typeof schema>;

export function sparklineModel(data: HistoryData, key: string): { points: number[]; last: number | null; delta: number | null } {
  const points = (data.series[key] ?? []).map(([, v]) => toNumber(v)).filter((v): v is number => v !== null);
  const last = points.at(-1) ?? null;
  return { points, last, delta: last !== null && points.length > 1 ? last - points[0]! : null };
}

export const sparkline: WidgetDefinition<Settings> = {
  type: 'sparkline',
  name: 'Sparkline',
  description: 'Current value with a small trend line over the time window.',
  icon: Activity,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'history', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const key = 'keys' in config.datasource ? (config.datasource.keys[0] ?? '') : '';
    const model = useMemo(() => (isHistory(data) ? sparklineModel(data, key) : null), [data, key]);
    const def = keyDef(profile, key);
    const option = useMemo(
      () =>
        model && {
          grid: { left: 0, right: 0, top: 4, bottom: 0 },
          xAxis: { type: 'category', show: false, data: model.points.map((_, i) => i) },
          yAxis: { type: 'value', show: false, scale: true },
          series: [{ type: 'line', data: model.points, showSymbol: false, lineStyle: { color: settings.color, width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${settings.color}40` }, { offset: 1, color: `${settings.color}00` }] } } }],
        },
      [model, settings.color],
    );
    return (
      <WidgetStatus result={result} empty={model?.points.length === 0}>
        <div className="flex h-full flex-col">
          <Readout size="md" {...splitUnit(model?.last !== null && model ? formatNumber(model.last!, def?.decimals, def?.unit) : '—', def?.unit)} />
          {model?.delta !== null && model && (
            <div className="mt-1 text-xs font-medium tabular-nums text-fg-muted">
              {model.delta! >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(model.delta!), def?.decimals)}
            </div>
          )}
          <div className="min-h-0 flex-1">{option && <EChart option={option} label={config.title ?? 'Sparkline'} />}</div>
        </div>
      </WidgetStatus>
    );
  },
};
