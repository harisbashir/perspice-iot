import { z } from 'zod';
import { field } from '../../forms/fields';

/** Range and warning/critical thresholds shared by gauges and level widgets. */
export const rangeSettings = {
  min: field.number('Minimum').default(0),
  max: field.number('Maximum').default(100),
  decimals: field.number('Decimals', { min: 0, max: 6, int: true }).default(0),
  unit: field.text('Unit', { max: 20 }).default(''),
  warnAt: field.number('Warning threshold').optional(),
  critAt: field.number('Critical threshold').optional(),
  lowIsBad: field.boolean('Low values are bad', 'Warn below the thresholds instead of above').default(false),
};
export const RangeSchema = z.object(rangeSettings);
export type RangeSettings = z.infer<typeof RangeSchema>;

export type Band = 'ok' | 'warn' | 'crit';

export function bandOf(s: Pick<RangeSettings, 'warnAt' | 'critAt' | 'lowIsBad'>, v: number | null): Band {
  if (v === null) return 'ok';
  const past = (t: number | undefined) => t !== undefined && (s.lowIsBad ? v <= t : v >= t);
  if (past(s.critAt)) return 'crit';
  if (past(s.warnAt)) return 'warn';
  return 'ok';
}

/** Band colours as hex, for canvases (ECharts) that can't read CSS variables. */
export const BAND_COLOR: Record<Band, string> = { ok: '#34C759', warn: '#FF9500', crit: '#FF3B30' };
/** The same bands as theme tokens (they brighten in dark mode), for HTML and SVG. */
export const BAND_VAR: Record<Band, string> = { ok: 'rgb(var(--ok-vivid))', warn: 'rgb(var(--warn-vivid))', crit: 'rgb(var(--crit-vivid))' };
/** Band text colours that pass contrast on a surface. */
export const BAND_TEXT: Record<Band, string> = { ok: '', warn: 'text-warn', crit: 'text-crit' };

/** The band a value at fraction `f` of the range falls in: for segmented meters and zone arcs. */
export function bandAtFraction(s: Pick<RangeSettings, 'min' | 'max' | 'warnAt' | 'critAt' | 'lowIsBad'>, f: number): Band {
  return bandOf(s, s.min + f * (s.max - s.min));
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
