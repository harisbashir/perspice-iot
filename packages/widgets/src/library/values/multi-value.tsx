import { LayoutList } from 'lucide-react';
import { z } from 'zod';
import { formatValue, keyDef } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';

const schema = z.object({ columns: field.number('Columns', { min: 1, max: 4, int: true }).default(2) });
type Settings = z.infer<typeof schema>;

export const multiValueWidget: WidgetDefinition<Settings> = {
  type: 'multi-value',
  name: 'Multi-value card',
  description: 'Several latest values with their labels in a compact grid.',
  icon: LayoutList,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 12 } },
  defaultSize: { w: 4, h: 4 },
  Component: ({ config, settings, result, profile }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    return (
      <WidgetStatus result={result}>
        <dl className="grid gap-3" style={{ gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }}>
          {keys.map((k) => {
            const def = keyDef(profile, k);
            return (
              <div key={k}>
                <dt className="text-xs text-slate-500">{def?.label ?? k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatValue(isLatest(data) ? data.values[k]?.v : undefined, def)}</dd>
              </div>
            );
          })}
        </dl>
      </WidgetStatus>
    );
  },
};
