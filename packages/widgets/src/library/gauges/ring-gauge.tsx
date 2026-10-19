import { CircleDashed } from 'lucide-react';
import { z } from 'zod';
import { formatValue, keyDef, toNumber } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, bandOf, clamp, rangeSettings } from '../charts/thresholds';
import { arcPath } from '../shared/geometry';

const schema = z.object({
  ...rangeSettings,
  colorBy: field.select('Ring colour', ['series', 'band'] as const, 'A colour per ring, or green/amber/red by the thresholds').default('series'),
});
type Settings = z.infer<typeof schema>;

/** One colour per ring, outermost first: system blue, teal and purple, kept clear of the status colours. */
export const RING_COLORS = ['rgb(var(--info-vivid))', '#30B0C7', '#AF52DE'];
const RADII = [42, 31, 20];
const WIDTH = 9;

export function ringFractions(s: Pick<Settings, 'min' | 'max'>, values: (number | null)[]): number[] {
  const span = s.max - s.min || 1;
  return values.map((v) => (v === null ? 0 : (clamp(v, s.min, s.max) - s.min) / span));
}

/**
 * Up to three values as concentric rings, each filled to its share of the range, with a legend
 * beside them (below when the widget is narrow). All rings share one range: suited to percentages
 * such as fuel, battery and humidity.
 */
export const ringGauge: WidgetDefinition<Settings> = {
  type: 'ring-gauge',
  name: 'Rings',
  description: 'Up to three values as concentric rings, each filled to its share of the range.',
  icon: CircleDashed,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 3 } },
  defaultSize: { w: 4, h: 5 },
  Component: ({ config, settings, result, profile }) => {
    const data = dataOf(result);
    const keys = ('keys' in config.datasource ? config.datasource.keys : []).slice(0, 3);
    const values = keys.map((k) => (isLatest(data) ? toNumber(data.values[k]?.v) : null));
    const fractions = ringFractions(settings, values);
    const colorOf = (i: number) => (settings.colorBy === 'band' ? BAND_VAR[bandOf(settings, values[i] ?? null)] : RING_COLORS[i]!);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full flex-col items-center gap-2 @[15rem]:flex-row @[15rem]:gap-4">
          <svg aria-hidden viewBox="0 0 100 100" className="aspect-square min-h-0 w-auto flex-1 @[15rem]:h-full @[15rem]:flex-none">
            {keys.map((k, i) => (
              <g key={k}>
                <circle cx={50} cy={50} r={RADII[i]} fill="none" stroke={colorOf(i)} strokeOpacity={0.18} strokeWidth={WIDTH} />
                {fractions[i]! > 0.004 && <path d={arcPath(50, 50, RADII[i]!, 0, fractions[i]! * 360)} fill="none" stroke={colorOf(i)} strokeWidth={WIDTH} strokeLinecap="round" />}
              </g>
            ))}
          </svg>
          <ul className="grid w-full min-w-0 gap-1.5 @[15rem]:flex-1">
            {keys.map((k, i) => {
              const def = keyDef(profile, k);
              return (
                <li
                  key={k}
                  role="meter"
                  aria-label={def?.label ?? k}
                  aria-valuemin={settings.min}
                  aria-valuemax={settings.max}
                  aria-valuenow={values[i] ?? settings.min}
                  className="flex min-w-0 items-baseline gap-2"
                >
                  <span aria-hidden className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ backgroundColor: colorOf(i) }} />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{def?.label ?? k}</span>
                  <span className="font-rounded text-sm font-semibold tabular-nums">{formatValue(values[i], { decimals: settings.decimals, unit: settings.unit || def?.unit })}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </WidgetStatus>
    );
  },
};
