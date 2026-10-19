import { Cylinder } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, bandOf, clamp, rangeSettings } from '../charts/thresholds';
import { Readout } from '../shared/Readout';
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
            className="relative h-full w-14 shrink-0 overflow-hidden rounded-[14px] bg-fill"
          >
            {/* Quarter marks, then the liquid. */}
            {[25, 50, 75].map((m) => (
              <span key={m} aria-hidden className="absolute inset-x-3 h-px bg-fg-muted/25" style={{ bottom: `${m}%` }} />
            ))}
            <div className="absolute inset-x-0 bottom-0 transition-[height] duration-700" style={{ height: `${pct}%`, backgroundColor: BAND_VAR[bandOf(settings, num)] }} />
          </div>
          <div className="pb-1">
            <Readout text={String(pct)} unit="%" />
            <div className="mt-1.5 text-xs text-fg-muted">
              {num === null ? '—' : formatNumber(num, settings.decimals, settings.unit || def?.unit)}
              {settings.capacity ? ` of ${settings.capacity}` : ''}
            </div>
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
