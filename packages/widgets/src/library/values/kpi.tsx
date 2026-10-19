import { Gauge } from 'lucide-react';
import { z } from 'zod';
import { dataOf, isStats } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { Readout } from '../shared/Readout';
import { MiniRing } from '../shared/MiniRing';

const METRICS = ['total', 'online', 'offline', 'dead', 'never', 'messages24h'] as const;
/** The ring's colour per status; `total` and `messages24h` have no share to show. */
const RING: Record<(typeof METRICS)[number], string | null> = {
  total: null,
  online: 'rgb(var(--ok-vivid))',
  offline: 'rgb(var(--warn-vivid))',
  dead: 'rgb(var(--crit-vivid))',
  never: 'rgb(var(--fg-muted))',
  messages24h: null,
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
  data: { mode: 'stats', sources: ['devicesOfProfile', 'currentAsset'] },
  defaultSize: { w: 2, h: 3 },
  Component: ({ settings, result }) => {
    const data = dataOf(result);
    const value = isStats(data) ? data[settings.metric] : null;
    const total = isStats(data) ? data.total : 0;
    const ring = RING[settings.metric];
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full items-end justify-between gap-2 pb-1">
          <div data-testid="kpi">
            <Readout text={value === null ? '—' : value.toLocaleString()} />
          </div>
          {ring && value !== null && total > 0 && (
            <div className="flex flex-col items-end gap-1">
              <MiniRing fraction={value / total} color={ring} />
              <span className="text-[11px] font-medium tabular-nums text-fg-muted">{Math.round((value / total) * 100)}% of {total.toLocaleString()}</span>
            </div>
          )}
        </div>
      </WidgetStatus>
    );
  },
};
