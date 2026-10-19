import { Percent } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, bandOf, clamp, rangeSettings } from '../charts/thresholds';
import { Readout, splitUnit } from '../shared/Readout';
import { firstValue } from './shared';

const schema = z.object(rangeSettings);
type Settings = z.infer<typeof schema>;

export const fractionOf = (s: Pick<Settings, 'min' | 'max'>, v: number | null) =>
  v === null ? 0 : (clamp(v, s.min, s.max) - s.min) / (s.max - s.min || 1);

export const progressWidget: WidgetDefinition<Settings> = {
  type: 'progress',
  name: 'Progress bar',
  description: 'A value as a percentage of its range.',
  icon: Percent,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 4, h: 2 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const pct = Math.round(fractionOf(settings, num) * 100);
    const def = keyDef(profile, key);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full flex-col justify-end gap-2 pb-1">
          <div className="flex items-baseline justify-between gap-2">
            <Readout size="md" {...splitUnit(num === null ? '—' : formatNumber(num, settings.decimals, settings.unit || def?.unit), settings.unit || def?.unit)} />
            <span className="text-[13px] font-medium tabular-nums text-fg-muted">{pct}%</span>
          </div>
          <div role="progressbar" aria-label={config.title ?? key} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-fill-strong">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: BAND_VAR[bandOf(settings, num)] }} />
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
