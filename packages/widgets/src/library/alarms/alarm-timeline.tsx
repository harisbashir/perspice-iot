import { History } from 'lucide-react';
import { z } from 'zod';
import { dataOf, isAlarmList } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import type { WidgetDefinition } from '../../sdk';
import { Severity, ago } from './shared';

const schema = z.object({});
type Settings = z.infer<typeof schema>;

/** Raised and cleared moments of recent alarms, newest first. */
export const alarmTimeline: WidgetDefinition<Settings> = {
  type: 'alarm-timeline',
  name: 'Alarm timeline',
  description: 'When recent alarms started and cleared.',
  icon: History,
  category: 'other',
  settingsSchema: schema,
  data: { mode: 'list', sources: ['alarms'] },
  defaultSize: { w: 4, h: 6 },
  Component: ({ result, actions }) => {
    const data = dataOf(result);
    const events = isAlarmList(data)
      ? data.alarms
          .flatMap((a) => [
            { key: `${a.id}-r`, ts: a.startedAt, a, what: 'raised' as const },
            ...(a.clearedAt ? [{ key: `${a.id}-c`, ts: a.clearedAt, a, what: 'cleared' as const }] : []),
          ])
          .sort((x, y) => y.ts - x.ts)
      : [];
    return (
      <WidgetStatus result={result} empty={isAlarmList(data) && events.length === 0}>
        <ol className="h-full space-y-2 overflow-auto pr-1">
          {events.map((e) => (
            <li key={e.key} className={`border-l-2 pl-2 text-sm ${e.what === 'raised' ? 'border-crit-vivid' : 'border-ok-vivid'}`}>
              <div className="flex items-center gap-2">
                <Severity severity={e.a.severity} />
                <button type="button" className="truncate font-medium hover:underline" onClick={() => actions.openAlarm(e.a.id)}>
                  {e.a.ruleName}
                </button>
              </div>
              <div className="text-xs text-fg-muted">
                {e.what === 'raised' ? 'Raised' : 'Cleared'} on {e.a.device.name} · <span title={new Date(e.ts).toLocaleString()}>{ago(e.ts)}</span>
              </div>
            </li>
          ))}
        </ol>
      </WidgetStatus>
    );
  },
};
