import { BellRing } from 'lucide-react';
import { z } from 'zod';
import { dataOf, isAlarmStats } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { Readout } from '../shared/Readout';

const METRICS = ['total', 'unacknowledged', 'critical', 'major', 'minor', 'warning'] as const;
/** A severity dot beside the count; the count itself stays in the label colour. */
const DOT: Record<(typeof METRICS)[number], string> = {
  total: 'bg-fg-muted',
  unacknowledged: 'bg-crit-vivid',
  critical: 'bg-crit-vivid',
  major: 'bg-[#FF6B00]',
  minor: 'bg-warn-vivid',
  warning: 'bg-info-vivid',
};

const schema = z.object({ metric: field.select('Count', METRICS).default('total') });
type Settings = z.infer<typeof schema>;

export const alarmKpi: WidgetDefinition<Settings> = {
  type: 'alarm-kpi',
  name: 'Active alarms',
  description: 'Open alarms in view: all, unacknowledged, or one severity.',
  icon: BellRing,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'stats', sources: ['alarms'] },
  defaultSize: { w: 2, h: 3 },
  Component: ({ settings, result }) => {
    const data = dataOf(result);
    const value = isAlarmStats(data) ? data[settings.metric] : null;
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full items-end justify-between gap-2 pb-1">
          <span data-testid="alarm-kpi">
            <Readout text={value === null ? '—' : value.toLocaleString()} className={value ? '' : 'text-fg-muted'} />
          </span>
          {/* A dot only while there is something to look at. */}
          {!!value && <span aria-hidden className={`mb-2 h-2.5 w-2.5 rounded-full ${DOT[settings.metric]}`} />}
        </div>
      </WidgetStatus>
    );
  },
};
