import { Siren } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { dataOf, isAlarmList } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { row, td, th } from '../tables/styles';
import { Severity, ago } from './shared';

const schema = z.object({ showDevice: field.boolean('Show the device column').default(true) });
type Settings = z.infer<typeof schema>;

export const alarmTable: WidgetDefinition<Settings> = {
  type: 'alarm-table',
  name: 'Alarm table',
  description: 'The newest alarms with severity and status; acknowledge from the table.',
  icon: Siren,
  category: 'table',
  settingsSchema: schema,
  data: { mode: 'list', sources: ['alarms'] },
  defaultSize: { w: 8, h: 6 },
  Component: ({ settings, result, can, actions }) => {
    const data = dataOf(result);
    const list = isAlarmList(data) ? data : null;
    const [busy, setBusy] = useState<string | null>(null);
    return (
      <WidgetStatus result={result} empty={!!list && list.alarms.length === 0}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr>
                  <th className={th}>Severity</th>
                  <th className={th}>Alarm</th>
                  {settings.showDevice && <th className={th}>Device</th>}
                  <th className={th}>Started</th>
                  <th className={th}>Status</th>
                  {can.ack && <th className={th} />}
                </tr>
              </thead>
              <tbody>
                {list?.alarms.map((a) => (
                  <tr key={a.id} className={row}>
                    <td className={td}>
                      <Severity severity={a.severity} />
                    </td>
                    <td className={td}>
                      <a
                        href={`/alarms/${a.id}`}
                        className="font-medium text-primary-700 hover:underline dark:text-primary-300"
                        onClick={(e) => {
                          e.preventDefault();
                          actions.openAlarm(a.id);
                        }}
                      >
                        {a.ruleName}
                      </a>
                    </td>
                    {settings.showDevice && <td className={td}>{a.device.name}</td>}
                    <td className={td} title={new Date(a.startedAt).toLocaleString()}>
                      {ago(a.startedAt)}
                    </td>
                    <td className={`${td} capitalize`}>{a.status}</td>
                    {can.ack && (
                      <td className={td}>
                        {a.status === 'active' && (
                          <button
                            type="button"
                            disabled={busy === a.id}
                            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                            onClick={() => {
                              setBusy(a.id);
                              void actions.ackAlarm(a.id).finally(() => setBusy(null));
                            }}
                          >
                            Acknowledge
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list && list.total > list.alarms.length && <div className="pt-1 text-right text-xs text-slate-500">{list.alarms.length} of {list.total}</div>}
        </div>
      </WidgetStatus>
    );
  },
};
