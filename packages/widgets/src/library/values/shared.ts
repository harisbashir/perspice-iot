import type { WidgetConfig, WidgetDataResult } from '@perspice/shared';
import { keyDef, toNumber } from '../../data/format';
import { dataOf, isLatest } from '../../data/result';
import type { WidgetProps } from '../../sdk';

/** The first datasource key and its latest value for single-value widgets. */
export function firstValue(config: WidgetConfig, result: WidgetDataResult | undefined) {
  const key = 'keys' in config.datasource ? (config.datasource.keys[0] ?? '') : '';
  const data = dataOf(result);
  const raw = isLatest(data) ? data.values[key]?.v : undefined;
  return { key, raw, num: toNumber(raw) };
}

export const defFor = (p: WidgetProps<unknown>, key: string) => keyDef(p.profile, key);
