import { Cylinder } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { BAND_COLOR, bandOf, clamp, rangeSettings } from '../charts/thresholds';
import { firstValue } from './shared';
import { fractionOf } from './progress';

const schema = z.object({ ...rangeSettings, lowIsBad: field.boolean('Low values are bad').default(true), capacity: field.text('Capacity label', { max: 40, help: 'e.g. 1,000 L' }).optional() });
type Settings = z.infer<typeof schema>;

export const tankWidget: WidgetDefinition<Settings> = {
  type: 'tank',
  name: 'Tank level',
  description: 'A vertical tank filled to the current level.',
  icon: Cylinder,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 5 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const pct = Math.round(fractionOf(settings, num) * 100);
    const def = keyDef(profile, key);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full items-end gap-3">
          <div
            role="meter"
            aria-label={`Level ${config.title ?? key}`}
            aria-valuemin={settings.min}
            aria-valuemax={settings.max}
            aria-valuenow={num === null ? settings.min : clamp(num, settings.min, settings.max)}
            className="relative h-full w-14 overflow-hidden rounded-b-lg rounded-t-md border-2 border-slate-400"
          >
            <div className="absolute inset-x-0 bottom-0 transition-all" style={{ height: `${pct}%`, backgroundColor: BAND_COLOR[bandOf(settings, num)], opacity: 0.8 }} />
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{pct}%</div>
            <div className="text-xs text-slate-500">
              {num === null ? '—' : formatNumber(num, settings.decimals, settings.unit || def?.unit)}
              {settings.capacity ? ` of ${settings.capacity}` : ''}
            </div>
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
