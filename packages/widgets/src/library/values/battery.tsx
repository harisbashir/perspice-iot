import { BatteryMedium } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { firstValue } from './shared';
import { fractionOf } from './progress';
import { Readout } from '../shared/Readout';

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
            className="relative h-9 w-[4.5rem] shrink-0 rounded-[9px] border-2 border-fg-muted/50 p-[3px]"
          >
            <div className={`h-full rounded-[5px] transition-[width] duration-500 ${low ? 'bg-crit-vivid' : 'bg-ok-vivid'}`} style={{ width: `${pct}%` }} />
            <span aria-hidden className="absolute -right-[5px] top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-r-sm bg-fg-muted/50" />
          </div>
          <div>
            <Readout size="md" text={String(pct)} unit="%" />
            {/* The raw reading, unless it is the percentage already shown. */}
            {(def?.unit !== '%' || low) && (
              <div className={`mt-1 text-xs ${low ? 'font-medium text-crit' : 'text-fg-muted'}`}>
                {def?.unit !== '%' && (num === null ? '—' : formatNumber(num, def?.decimals, def?.unit))}
                {low && (def?.unit !== '%' ? ' · low' : 'Low')}
              </div>
            )}
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
