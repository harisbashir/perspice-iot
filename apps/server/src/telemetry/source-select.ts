export type TelemetrySource = 'raw' | '1m' | '1h' | '1d';

const RAW_MAX_RANGE_MS = 6 * 3_600_000;
const BUCKETS: [TelemetrySource, number][] = [
  ['1m', 60_000],
  ['1h', 3_600_000],
  ['1d', 86_400_000],
];

/** The finest source whose point count over the range stays within `maxPoints`. */
export function selectSource(fromMs: number, toMs: number, maxPoints = 2000): TelemetrySource {
  const range = toMs - fromMs;
  if (range <= RAW_MAX_RANGE_MS) return 'raw';
  for (const [source, bucket] of BUCKETS) if (range / bucket <= maxPoints) return source;
  return '1d';
}
