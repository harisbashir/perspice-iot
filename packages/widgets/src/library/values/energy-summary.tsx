import type { EnergyData, EnergyRange } from '@perspice/shared';
import { Zap } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { dataOf, isEnergy } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { EChart } from '../charts/EChart';

const RANGES = ['today', 'week', 'month', 'year', 'window'] as const satisfies readonly EnergyRange[];
const PREVIOUS: Record<(typeof RANGES)[number], string> = {
  today: 'yesterday',
  week: 'last week',
  month: 'last month',
  year: 'last year',
  window: 'the period before',
};

const schema = z.object({
  range: field.select('Period', RANGES, 'This day, week, month or year so far (in the customer’s timezone), or the dashboard’s time window.').default('month'),
  showChart: field.boolean('Bars per hour, day or month').default(true),
});
type Settings = z.infer<typeof schema>;

const fmtNumber = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : n < 1000 ? 1 : 0 });
export const fmtMoney = (n: number, currency: string) => {
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

/** The change against the previous period (null when there was nothing to compare with). */
export function changePct(data: EnergyData): number | null {
  if (!data.previous.consumption) return null;
  return Math.round(((data.total.consumption - data.previous.consumption) / data.previous.consumption) * 100);
}

export function energyBarOption(data: EnergyData) {
  const label = (p: string) => (data.period === 'hour' ? p.slice(11, 16) : data.period === 'month' ? p : p.slice(5));
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 8, top: 8, bottom: 24 },
    xAxis: { type: 'category', data: data.periods.map((p) => label(p.period)) },
    yAxis: { type: 'value', name: data.unit ?? undefined },
    series: [{ type: 'bar', name: data.key, data: data.periods.map((p) => p.consumption) }],
  };
}

export const energySummary: WidgetDefinition<Settings> = {
  type: 'energy-summary',
  name: 'Energy summary',
  description: 'Consumption and cost this period, the change against the last one, and bars per hour, day or month. Use a per-interval key such as a counter delta.',
  icon: Zap,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'energy', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 4, h: 6 },
  Component: ({ settings, result }) => {
    const data = dataOf(result);
    const energy = isEnergy(data) ? data : null;
    const option = useMemo(() => (energy ? energyBarOption(energy) : null), [energy]);
    const change = energy ? changePct(energy) : null;
    return (
      <WidgetStatus result={result}>
        {energy && (
          <div className="flex h-full flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span data-testid="energy-total" className="text-3xl font-semibold tabular-nums">
                {fmtNumber(energy.total.consumption)}
                {energy.unit ? ` ${energy.unit}` : ''}
              </span>
              {energy.total.cost !== null && energy.currency && (
                <span data-testid="energy-cost" className="text-lg tabular-nums text-slate-600 dark:text-slate-300">
                  {fmtMoney(energy.total.cost, energy.currency)}
                </span>
              )}
            </div>
            {change !== null && (
              <p data-testid="energy-change" className={`text-xs ${change > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}% compared with {PREVIOUS[settings.range]} so far
              </p>
            )}
            {settings.showChart && option && energy.periods.length > 0 && (
              <div className="min-h-0 flex-1">
                <EChart option={option} label={`${energy.key} per ${energy.period}`} />
              </div>
            )}
          </div>
        )}
      </WidgetStatus>
    );
  },
};
