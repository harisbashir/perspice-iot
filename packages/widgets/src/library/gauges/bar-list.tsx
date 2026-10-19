import { ChartBarDecreasing } from 'lucide-react';
import { z } from 'zod';
import { formatValue, keyDef, toNumber } from '../../data/format';
import { dataOf, isFleet, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, bandOf } from '../charts/thresholds';

const schema = z.object({
  sort: field.select('Order', ['desc', 'asc', 'none'] as const, 'Largest first, smallest first, or as configured').default('desc'),
  limit: field.number('Rows', { min: 1, max: 50, int: true }).default(8),
  max: field.number('Full bar at', { help: 'Defaults to the largest value shown' }).optional(),
  decimals: field.number('Decimals', { min: 0, max: 6, int: true, help: 'Defaults to the profile setting' }).optional(),
  warnAt: field.number('Warning threshold').optional(),
  critAt: field.number('Critical threshold').optional(),
  lowIsBad: field.boolean('Low values are bad', 'Warn below the thresholds instead of above').default(false),
});
type Settings = z.infer<typeof schema>;

export interface BarRow {
  id: string;
  label: string;
  value: number | null;
  /** Set for fleet rows: the device to open. */
  deviceId?: string;
}

/** Sorted, limited rows with each bar's length as a fraction of the longest (or of `max`). */
export function barRows(rows: BarRow[], s: Pick<Settings, 'sort' | 'limit' | 'max'>): (BarRow & { fraction: number })[] {
  const sorted = s.sort === 'none' ? rows : [...rows].sort((a, b) => ((b.value ?? -Infinity) - (a.value ?? -Infinity)) * (s.sort === 'desc' ? 1 : -1));
  const shown = sorted.slice(0, s.limit);
  const top = s.max ?? Math.max(0, ...shown.map((r) => Math.abs(r.value ?? 0)));
  return shown.map((r) => ({ ...r, fraction: r.value === null || top === 0 ? 0 : Math.min(1, Math.abs(r.value) / top) }));
}

/**
 * Horizontal bars with their labels above, ranked: one key across a fleet (a row per device, which
 * opens it), or several keys of one device. Bars take the brand colour, or the band colours when
 * thresholds are set.
 */
export const barList: WidgetDefinition<Settings> = {
  type: 'bar-list',
  name: 'Ranked bars',
  description: 'Values as ranked horizontal bars: one key across devices, or several keys of one device.',
  icon: ChartBarDecreasing,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device', 'devicesOfProfile', 'currentAsset'], keys: { min: 1, max: 12 } },
  defaultSize: { w: 4, h: 6 },
  Component: ({ config, settings, result, profile, actions }) => {
    const data = dataOf(result);
    const keys = 'keys' in config.datasource ? config.datasource.keys : [];
    const first = keys[0] ?? '';
    const rows: BarRow[] = isFleet(data)
      ? data.devices.map((d) => ({ id: d.id, label: d.name, value: toNumber(d.values[first]?.v), deviceId: d.id }))
      : isLatest(data)
        ? keys.map((k) => ({ id: k, label: keyDef(profile, k)?.label ?? k, value: toNumber(data.values[k]?.v) }))
        : [];
    const banded = settings.warnAt !== undefined || settings.critAt !== undefined;
    const defFor = (r: BarRow) => keyDef(profile, r.deviceId ? first : r.id);
    return (
      <WidgetStatus result={result} empty={rows.length === 0}>
        <ul className="flex h-full flex-col gap-2.5 overflow-y-auto pr-0.5">
          {barRows(rows, settings).map((r) => {
            const def = defFor(r);
            const label = (
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="shrink-0 font-rounded font-semibold tabular-nums">{formatValue(r.value, { decimals: settings.decimals ?? def?.decimals, unit: def?.unit })}</span>
              </span>
            );
            return (
              <li key={r.id} className="min-w-0">
                {r.deviceId ? (
                  <button type="button" className="block w-full rounded text-left hover:text-primary-700 dark:hover:text-primary-300" onClick={() => actions.openDevice(r.deviceId!)}>
                    {label}
                  </button>
                ) : (
                  label
                )}
                <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${banded ? '' : 'bg-primary-500'}`}
                    style={{ width: `${r.fraction * 100}%`, ...(banded ? { backgroundColor: BAND_VAR[bandOf(settings, r.value)] } : {}) }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </WidgetStatus>
    );
  },
};
