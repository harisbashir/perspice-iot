import { Gauge } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { formatNumber, keyDef, toNumber } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from './EChart';
import { BAND_COLOR, type RangeSettings, bandOf, clamp, rangeSettings } from './thresholds';

const schema = z.object(rangeSettings);

export function gaugeOption(s: RangeSettings, raw: number | null) {
  const value = raw === null ? s.min : clamp(raw, s.min, s.max);
  return {
    series: [
      {
        type: 'gauge',
        min: s.min,
        max: s.max,
        progress: { show: true, width: 12, itemStyle: { color: BAND_COLOR[bandOf(s, raw)] } },
        axisLine: { lineStyle: { width: 12 } },
        pointer: { show: false },
        axisLabel: { distance: 16, fontSize: 10 },
        splitLine: { length: 8 },
        detail: { valueAnimation: true, offsetCenter: [0, '10%'], fontSize: 20, formatter: () => (raw === null ? '—' : formatNumber(raw, s.decimals, s.unit)) },
        data: [{ value }],
      },
    ],
  };
}

export const radialGauge: WidgetDefinition<RangeSettings> = {
  type: 'radial-gauge',
  name: 'Radial gauge',
  description: 'One value on a dial with warning and critical bands.',
  icon: Gauge,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 5 },
  Component: ({ settings, result, profile, config }) => {
    const data = dataOf(result);
    const key = 'keys' in config.datasource ? (config.datasource.keys[0] ?? '') : '';
    const option = useMemo(() => {
      if (!isLatest(data)) return null;
      const def = keyDef(profile, key);
      return gaugeOption({ ...settings, unit: settings.unit || def?.unit || '' }, toNumber(data.values[key]?.v));
    }, [data, settings, key, profile]);
    return <WidgetStatus result={result}>{option && <EChart option={option} label={config.title ?? 'Gauge'} />}</WidgetStatus>;
  },
};
