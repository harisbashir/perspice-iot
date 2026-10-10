import { BellRing } from 'lucide-react';
import { z } from 'zod';
import { dataOf, isAlarmStats } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';

const METRICS = ['total', 'unacknowledged', 'critical', 'major', 'minor', 'warning'] as const;
const COLORS: Record<(typeof METRICS)[number], string> = {
  total: '',
  unacknowledged: 'text-red-700 dark:text-red-400',
  critical: 'text-red-700 dark:text-red-400',
  major: 'text-orange-600 dark:text-orange-400',
  minor: 'text-amber-600 dark:text-amber-400',
  warning: 'text-sky-700 dark:text-sky-400',
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
        <div data-testid="alarm-kpi" className={`flex h-full items-center text-3xl font-semibold tabular-nums ${value ? COLORS[settings.metric] : ''}`}>
          {value === null ? '—' : value.toLocaleString()}
        </div>
      </WidgetStatus>
    );
  },
};
