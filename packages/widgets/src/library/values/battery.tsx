import { BatteryMedium } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { firstValue } from './shared';
import { fractionOf } from './progress';

const schema = z.object({
  min: field.number('Empty at').default(0),
  max: field.number('Full at').default(100),
  lowAt: field.number('Low below (%)', { min: 0, max: 100 }).default(20),
});
type Settings = z.infer<typeof schema>;

export const batteryWidget: WidgetDefinition<Settings> = {
  type: 'battery',
  name: 'Battery',
  description: 'Charge level from a voltage or percentage, with a low warning.',
  icon: BatteryMedium,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const pct = Math.round(fractionOf(settings, num) * 100);
    const def = keyDef(profile, key);
    const low = num !== null && pct < settings.lowAt;
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full items-center gap-3">
          <div
            role="meter"
            aria-label={`Battery ${config.title ?? key}`}
            aria-valuemin={settings.min}
            aria-valuemax={settings.max}
            aria-valuenow={num ?? settings.min}
            className="relative h-8 w-16 rounded border-2 border-slate-500 p-0.5"
          >
            <div className={`h-full rounded-sm ${low ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
            <span aria-hidden className="absolute -right-1.5 top-2 h-3 w-1 rounded-r bg-slate-500" />
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">{pct}%</div>
            <div className="text-xs text-slate-500">{num === null ? '—' : formatNumber(num, def?.decimals, def?.unit)}{low && ' · low'}</div>
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
