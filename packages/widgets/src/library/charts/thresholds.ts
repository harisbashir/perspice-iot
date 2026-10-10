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

export const BAND_COLOR: Record<Band, string> = { ok: '#16a34a', warn: '#d97706', crit: '#dc2626' };

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
