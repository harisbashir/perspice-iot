import { ArrowDown, ArrowUp, Hash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { formatValue, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { firstValue } from './shared';

const schema = z.object({
  showTrend: field.boolean('Show trend', 'Arrow comparing with the previous value').default(true),
  decimals: field.number('Decimals', { min: 0, max: 6, int: true, help: 'Defaults to the profile setting' }).optional(),
  unit: field.text('Unit', { max: 20, help: 'Defaults to the profile setting' }).optional(),
});
type Settings = z.infer<typeof schema>;

export const valueCard: WidgetDefinition<Settings> = {
  type: 'value-card',
  name: 'Value card',
  description: 'The latest value of one key, with an optional trend arrow.',
  icon: Hash,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },
  Component: ({ config, settings, result, profile }) => {
    const { key, raw, num } = firstValue(config, result);
    const def = keyDef(profile, key);
    const previous = useRef<number | null>(null);
    const [trend, setTrend] = useState<'up' | 'down' | null>(null);
    useEffect(() => {
      if (num === null) return;
      if (previous.current !== null && num !== previous.current) setTrend(num > previous.current ? 'up' : 'down');
      previous.current = num;
    }, [num]);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full flex-col justify-center">
          <div className="flex items-baseline gap-2">
            <span data-testid="value" className="text-3xl font-semibold tabular-nums">
              {formatValue(raw, { decimals: settings.decimals ?? def?.decimals, unit: settings.unit ?? def?.unit })}
            </span>
            {settings.showTrend && trend === 'up' && <ArrowUp aria-label="Rising" className="h-5 w-5 text-green-600" />}
            {settings.showTrend && trend === 'down' && <ArrowDown aria-label="Falling" className="h-5 w-5 text-red-600" />}
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
