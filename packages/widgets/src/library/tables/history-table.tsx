import type { HistoryData } from '@perspice/shared';
import { History } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { formatValue, keyDef } from '../../data/format';
import { dataOf, isHistory } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { row, td, th } from './styles';

const schema = z.object({ maxRows: field.number('Rows to show', { min: 10, max: 2000, int: true }).default(500) });
type Settings = z.infer<typeof schema>;

/** One row per timestamp with each key's value at that time, newest first. */
export function historyRows(data: HistoryData, keys: string[], max: number): [number, Record<string, unknown>][] {
  const byTs = new Map<number, Record<string, unknown>>();
  for (const k of keys) for (const [ts, v] of data.series[k] ?? []) byTs.set(ts, { ...byTs.get(ts), [k]: v });
  return [...byTs].sort((a, b) => b[0] - a[0]).slice(0, max);
}

export const historyTable: WidgetDefinition<Settings> = {
  type: 'history-table',
  name: 'History table',
  description: 'Values over the time window as rows, newest first.',
  icon: History,
  category: 'table',
  settingsSchema: schema,
  data: { mode: 'history', sources: ['currentDevice', 'device'], keys: { min: 1, max: 10 } },
  defaultSize: { w: 6, h: 8 },
  Component: ({ config, settings, result, profile }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    const rows = useMemo(() => (isHistory(data) ? historyRows(data, keys, settings.maxRows) : []), [data, keys, settings.maxRows]);
    return (
      <WidgetStatus result={result} empty={isHistory(data) && rows.length === 0}>
        <div className="h-full overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th className={th}>Time</th>
                {keys.map((k) => (
                  <th key={k} className={th}>
                    {keyDef(profile, k)?.label ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([ts, values]) => (
                <tr key={ts} className={row}>
                  <td className={`${td} whitespace-nowrap text-xs text-fg-muted`}>{new Date(ts).toLocaleString()}</td>
                  {keys.map((k) => (
                    <td key={k} className={`${td} tabular-nums`}>
                      {formatValue(values[k], keyDef(profile, k))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </WidgetStatus>
    );
  },
};
