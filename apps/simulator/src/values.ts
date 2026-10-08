import type { TelemetryKeyDef } from '@perspice/shared';

export interface Bounds {
  min: number;
  max: number;
  step: number;
}

/** Plausible ranges for well-known keys; anything else wanders between 0 and 100. */
export function boundsFor(key: string): Bounds {
  if (/mains_v|voltage/.test(key)) return { min: 200, max: 245, step: 2 };
  if (/batt_v/.test(key)) return { min: 44, max: 56, step: 0.2 };
  if (/temp/.test(key)) return { min: -10, max: 45, step: 0.5 };
  if (/humid|level|pct|percent/.test(key)) return { min: 0, max: 100, step: 1.5 };
  return { min: 0, max: 100, step: 2 };
}

/** A bounded random walk: each call moves at most `step` and never leaves [min, max]. */
export function randomWalk(bounds: Bounds, start?: number, rand: () => number = Math.random): () => number {
  let value = start ?? bounds.min + (bounds.max - bounds.min) * rand();
  return () => {
    value += (rand() * 2 - 1) * bounds.step;
    value = Math.min(bounds.max, Math.max(bounds.min, value));
    return Math.round(value * 100) / 100;
  };
}

/** Generates one telemetry message's values for the profile's keys. */
export function valueGenerator(keys: TelemetryKeyDef[], rand: () => number = Math.random): () => Record<string, unknown> {
  const gens = keys.map((k) => {
    if (k.type === 'number') return [k.key, randomWalk(boundsFor(k.key), undefined, rand)] as const;
    if (k.type === 'boolean') {
      let state = rand() < 0.5;
      return [k.key, () => (rand() < 0.05 ? (state = !state) : state)] as const;
    }
    if (k.type === 'string') return [k.key, () => 'ok'] as const;
    return [k.key, () => ({ sample: Math.round(rand() * 1000) })] as const;
  });
  return () => Object.fromEntries(gens.map(([key, gen]) => [key, gen()]));
}
