import { AlignVerticalJustifyEnd } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, type Band, bandAtFraction, clamp, rangeSettings } from '../charts/thresholds';
import { Readout, splitUnit } from '../shared/Readout';
import { firstValue } from '../values/shared';

const schema = z.object({
  ...rangeSettings,
  segments: field.number('Segments', { min: 4, max: 30, int: true }).default(12),
  vertical: field.boolean('Vertical').default(false),
});
type Settings = z.infer<typeof schema>;

/** Which segments are lit, and each segment's band by where it sits in the range (like an LED meter). */
export function segmentsOf(s: Settings, v: number | null): { lit: boolean; band: Band }[] {
  const span = s.max - s.min || 1;
  const f = v === null ? 0 : (clamp(v, s.min, s.max) - s.min) / span;
  const lit = Math.round(f * s.segments);
  return Array.from({ length: s.segments }, (_, i) => ({ lit: i < lit, band: bandAtFraction(s, (i + 0.5) / s.segments) }));
}

/** A segmented meter: lit segments take the colour of the zone they sit in, so the thresholds read at a glance. */
export const barGauge: WidgetDefinition<Settings> = {
  type: 'bar-gauge',
  name: 'Segmented meter',
  description: 'A value as lit segments, each coloured by the zone it sits in (an LED meter).',
  icon: AlignVerticalJustifyEnd,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 4, h: 3 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const unit = settings.unit || keyDef(profile, key)?.unit;
    const segments = segmentsOf(settings, num);
    const meter = (
      <div
        role="meter"
        aria-label={config.title ?? key}
        aria-valuemin={settings.min}
        aria-valuemax={settings.max}
        aria-valuenow={num ?? settings.min}
        className={settings.vertical ? 'flex h-full w-7 shrink-0 flex-col-reverse gap-[3px]' : 'flex h-5 w-full gap-[3px]'}
      >
        {segments.map((seg, i) => (
          <span
            key={i}
            className={`flex-1 rounded-[3px] transition-colors duration-300 ${seg.lit ? '' : 'bg-fill-strong'}`}
            style={seg.lit ? { backgroundColor: BAND_VAR[seg.band] } : undefined}
          />
        ))}
      </div>
    );
    const value = <Readout size="md" {...splitUnit(num === null ? '—' : formatNumber(num, settings.decimals, unit), unit)} />;
    return (
      <WidgetStatus result={result}>
        {settings.vertical ? (
          <div className="flex h-full items-end gap-3 pb-1">
            {meter}
            {value}
          </div>
        ) : (
          <div className="flex h-full flex-col justify-end gap-2.5 pb-1">
            {value}
            {meter}
            <div className="-mt-1 flex justify-between text-[11px] tabular-nums text-fg-muted">
              <span>{settings.min}</span>
              <span>{settings.max}</span>
            </div>
          </div>
        )}
      </WidgetStatus>
    );
  },
};
