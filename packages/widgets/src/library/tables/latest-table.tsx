import { Table2 } from 'lucide-react';
import { z } from 'zod';
import { formatValue, keyDef, timeAgo } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { row, td, th } from './styles';

const schema = z.object({ showUpdated: field.boolean('Show when each value was updated').default(true) });
type Settings = z.infer<typeof schema>;

export const latestTable: WidgetDefinition<Settings> = {
  type: 'latest-table',
  name: 'Latest values table',
  description: 'Key, value and age for a set of keys of one device.',
  icon: Table2,
  category: 'table',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 50 } },
  defaultSize: { w: 6, h: 6 },
  Component: ({ config, settings, result, profile }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    return (
      <WidgetStatus result={result}>
        <div className="h-full overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Key</th>
                <th className={th}>Value</th>
                {settings.showUpdated && <th className={th}>Updated</th>}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const def = keyDef(profile, k);
                const lv = isLatest(data) ? data.values[k] : undefined;
                return (
                  <tr key={k} className={row}>
                    <td className={td}>{def?.label ?? k}</td>
                    <td className={`${td} font-medium tabular-nums`}>{formatValue(lv?.v, def)}</td>
                    {settings.showUpdated && <td className={`${td} text-fg-muted`}>{lv ? timeAgo(lv.ts) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </WidgetStatus>
    );
  },
};
