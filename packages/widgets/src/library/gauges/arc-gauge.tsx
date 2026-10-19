import { Gauge } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import type { WidgetDefinition } from '../../sdk';
import { BAND_VAR, type Band, type RangeSettings, bandOf, clamp, rangeSettings } from '../charts/thresholds';
import { usePulse } from '../shared/Readout';
import { arcPath } from '../shared/geometry';
import { firstValue } from '../values/shared';

const schema = z.object(rangeSettings);

/** The dial spans 240°, from 8 o'clock to 4 o'clock. */
const START = -120;
const SWEEP = 240;

/** Where the warning and critical zones sit on the dial, as [from, to] fractions of the range. */
export function zonesOf(s: Pick<RangeSettings, 'min' | 'max' | 'warnAt' | 'critAt' | 'lowIsBad'>): { band: Exclude<Band, 'ok'>; from: number; to: number }[] {
  const span = s.max - s.min || 1;
  const f = (v: number) => clamp((v - s.min) / span, 0, 1);
  const zones: { band: Exclude<Band, 'ok'>; from: number; to: number }[] = [];
  if (s.lowIsBad) {
    if (s.critAt !== undefined) zones.push({ band: 'crit', from: 0, to: f(s.critAt) });
    if (s.warnAt !== undefined) zones.push({ band: 'warn', from: s.critAt !== undefined ? f(s.critAt) : 0, to: f(s.warnAt) });
  } else {
    if (s.warnAt !== undefined) zones.push({ band: 'warn', from: f(s.warnAt), to: s.critAt !== undefined ? f(s.critAt) : 1 });
    if (s.critAt !== undefined) zones.push({ band: 'crit', from: f(s.critAt), to: 1 });
  }
  return zones.filter((z) => z.to > z.from);
}

export function arcGaugeModel(s: RangeSettings, v: number | null) {
  const span = s.max - s.min || 1;
  return { fraction: v === null ? 0 : (clamp(v, s.min, s.max) - s.min) / span, band: bandOf(s, v) };
}

/**
 * A dial drawn in SVG: the value as a coloured arc on a grey track, the warning and critical zones
 * as a thin outer rim, and the reading in the middle. Crisp at any size and in both appearances.
 */
export const arcGauge: WidgetDefinition<RangeSettings> = {
  type: 'arc-gauge',
  name: 'Dial',
  description: 'One value on a 240° dial, with its warning and critical zones marked on the rim.',
  icon: Gauge,
  category: 'chart',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 5 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const unit = settings.unit || keyDef(profile, key)?.unit || '';
    const m = arcGaugeModel(settings, num);
    const text = num === null ? '—' : formatNumber(num, settings.decimals);
    const pulse = usePulse(text);
    const C = 60;
    const R = 44;
    return (
      <WidgetStatus result={result}>
        <svg
          role="meter"
          aria-label={config.title ?? key}
          aria-valuemin={settings.min}
          aria-valuemax={settings.max}
          aria-valuenow={num ?? settings.min}
          aria-valuetext={num === null ? 'No value' : formatNumber(num, settings.decimals, unit)}
          viewBox="0 0 120 104"
          className="h-full w-full overflow-visible"
        >
          <path d={arcPath(C, 62, R, START, START + SWEEP)} fill="none" strokeWidth={9} strokeLinecap="round" className="stroke-fill-strong" />
          {zonesOf(settings).map((z) => (
            <path key={z.band} d={arcPath(C, 62, R + 8.5, START + z.from * SWEEP, START + z.to * SWEEP)} fill="none" stroke={BAND_VAR[z.band]} strokeWidth={2.5} opacity={0.85} />
          ))}
          {m.fraction > 0.004 && (
            <path
              d={arcPath(C, 62, R, START, START + m.fraction * SWEEP)}
              fill="none"
              stroke={BAND_VAR[m.band]}
              strokeWidth={9}
              strokeLinecap="round"
              style={{ transition: 'd 0.6s cubic-bezier(0.32, 0.72, 0, 1)' }}
            />
          )}
          <text x={C} y={64} textAnchor="middle" className={`fill-current font-rounded font-semibold tabular-nums ${pulse ? 'animate-live' : ''}`} fontSize={text.length > 6 ? 18 : 22}>
            {text}
          </text>
          {unit && (
            <text x={C} y={79} textAnchor="middle" className="fill-fg-muted text-[9px] font-medium">
              {unit}
            </text>
          )}
          <text x={C - R * 0.87} y={100} textAnchor="middle" className="fill-fg-muted text-[8px] tabular-nums">
            {settings.min}
          </text>
          <text x={C + R * 0.87} y={100} textAnchor="middle" className="fill-fg-muted text-[8px] tabular-nums">
            {settings.max}
          </text>
        </svg>
      </WidgetStatus>
    );
  },
};
