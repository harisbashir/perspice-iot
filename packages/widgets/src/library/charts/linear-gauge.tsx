import { SlidersHorizontal } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, toNumber } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, type Band, type RangeSettings, bandOf, clamp, rangeSettings } from './thresholds';
import { Readout, splitUnit } from '../shared/Readout';

const schema = z.object(rangeSettings);

export function linearGaugeModel(s: RangeSettings, v: number | null): { fraction: number; band: Band; text: string } {
  const span = s.max - s.min || 1;
  return {
    fraction: v === null ? 0 : (clamp(v, s.min, s.max) - s.min) / span,
    band: bandOf(s, v),
    text: v === null ? '—' : formatNumber(v, s.decimals, s.unit),
  };
}

export const linearGauge: WidgetDefinition<RangeSettings> = {
  type: 'linear-gauge',
  name: 'Linear gauge',
  description: 'One value as a horizontal bar between minimum and maximum.',
  icon: SlidersHorizontal,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 4, h: 2 },
  Component: ({ settings, result, config }) => {
    const data = dataOf(result);
    const key = 'keys' in config.datasource ? (config.datasource.keys[0] ?? '') : '';
    const m = linearGaugeModel(settings, isLatest(data) ? toNumber(data.values[key]?.v) : null);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full flex-col justify-end gap-1.5 pb-1">
          <Readout size="md" {...splitUnit(m.text, settings.unit)} />
          <div
            role="meter"
            aria-label={config.title ?? key}
            aria-valuemin={settings.min}
            aria-valuemax={settings.max}
            aria-valuenow={m.fraction * (settings.max - settings.min) + settings.min}
            className="h-2 w-full overflow-hidden rounded-full bg-fill-strong"
          >
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${m.fraction * 100}%`, backgroundColor: BAND_VAR[m.band] }} />
          </div>
          <div className="flex justify-between text-[11px] tabular-nums text-fg-muted">
            <span>{settings.min}</span>
            <span>{settings.max}</span>
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
