import { Gauge } from 'lucide-react';
import { z } from 'zod';
import { dataOf, isStats } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';

const METRICS = ['total', 'online', 'offline', 'dead', 'never', 'messages24h'] as const;
const COLORS: Record<(typeof METRICS)[number], string> = {
  total: '',
  online: 'text-green-700 dark:text-green-400',
  offline: 'text-amber-700 dark:text-amber-400',
  dead: 'text-red-700 dark:text-red-400',
  never: 'text-slate-500',
  messages24h: '',
};

const schema = z.object({ metric: field.select('Metric', METRICS).default('total') });
type Settings = z.infer<typeof schema>;

export const kpiWidget: WidgetDefinition<Settings> = {
  type: 'kpi',
  name: 'Fleet KPI',
  description: 'A count over the devices in view: total, by status, or values received in 24 h.',
  icon: Gauge,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'stats', sources: ['devicesOfProfile'] },
  defaultSize: { w: 2, h: 3 },
  Component: ({ settings, result }) => {
    const data = dataOf(result);
    const value = isStats(data) ? data[settings.metric] : null;
    return (
      <WidgetStatus result={result}>
        <div data-testid="kpi" className={`flex h-full items-center text-3xl font-semibold tabular-nums ${COLORS[settings.metric]}`}>
          {value === null ? '—' : value.toLocaleString()}
        </div>
      </WidgetStatus>
    );
  },
};
