import {
  type DataRequest,
  type DataSource,
  type DeviceSummary,
  type EnergyData,
  type LatestValueDto,
  type TelemetryKeyDef,
  type WidgetDataResult,
  groupEnergy,
  periodFor,
} from '@perspice/shared';

/**
 * Made-up data for template previews: the widgets bound to the dashboard's own device or asset show
 * plausible values while a template is edited without one, so its maker can see the layout.
 */
export const isSampled = (ds: DataSource) => ds.kind === 'currentDevice' || ds.kind === 'currentAsset';

const HOUR = 3_600_000;
const RANGE_MS = { today: 12 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR, year: 365 * 24 * HOUR } as const;

/** A stable number in [0, 1) per string, so a key keeps its value between renders. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

function valueAt(key: string, def: TelemetryKeyDef | undefined, t: number, device = 0): unknown {
  const r = seed(key + device);
  const type = def?.type ?? 'number';
  if (type === 'boolean') return Math.floor(t / (6 * HOUR) + r * 4) % 2 === 0;
  if (type === 'string') return ['OK', 'Running', 'Idle'][Math.floor(r * 3)];
  if (type === 'json') return { sample: true };
  const base = 10 + r * 90;
  const v = base + base * 0.15 * Math.sin(t / (4 * HOUR) + r * 6) + base * 0.04 * Math.sin(t / (23 * 60_000));
  const decimals = def?.decimals ?? 1;
  return Number(v.toFixed(decimals));
}

function values(keys: string[], defs: TelemetryKeyDef[], now: number, device = 0): Record<string, LatestValueDto> {
  return Object.fromEntries(keys.map((k) => [k, { ts: now, v: valueAt(k, defs.find((d) => d.key === k), now, device) }]));
}

function windowOf(r: DataRequest, now: number): { from: number; to: number } {
  const tw = r.timewindow;
  if (r.mode === 'energy' && r.energyRange !== 'window') return { from: now - RANGE_MS[r.energyRange], to: now };
  if (tw?.kind === 'absolute') return { from: tw.fromMs, to: tw.toMs };
  return { from: now - (tw?.lastMs ?? 24 * HOUR), to: now };
}

const STATUSES: DeviceSummary['status'][] = ['online', 'online', 'online', 'offline', 'online', 'never'];

function device(i: number, now: number): DeviceSummary {
  return {
    id: `sample-${i}`,
    name: i === 0 ? 'Sample device' : `Sample device ${i + 1}`,
    status: STATUSES[i % STATUSES.length]!,
    lastSeen: now - i * 7 * 60_000,
    profileId: 'sample',
    customerId: null,
  };
}

/** The dashboard's own device in a preview. */
export const sampleDevice = (now = Date.now()) => device(0, now);

function location(i: number, now: number) {
  return { lat: 51.5 + Math.sin(i * 2.1) * 0.03, lng: -0.12 + Math.cos(i * 1.7) * 0.05, ts: now, source: 'reported' as const };
}

function energy(r: DataRequest, defs: TelemetryKeyDef[], now: number, devices: number): EnergyData {
  const key = r.datasource.kind !== 'none' && 'keys' in r.datasource ? (r.datasource.keys[0] ?? 'energy') : 'energy';
  const { from, to } = windowOf(r, now);
  const hours: { ts: number; v: number }[] = [];
  for (let ts = Math.ceil(from / HOUR) * HOUR; ts < to; ts += HOUR) {
    const daytime = 0.6 + 0.4 * Math.sin(((ts / HOUR) % 24) / 24 * 2 * Math.PI - Math.PI / 2);
    hours.push({ ts, v: Number((devices * 1.2 * (0.5 + daytime)).toFixed(3)) });
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const period = periodFor(from, to);
  const { periods, total } = groupEnergy(hours, period, timezone, null);
  return {
    key,
    unit: defs.find((d) => d.key === key)?.unit ?? 'kWh',
    timezone,
    currency: null,
    period,
    periods,
    total,
    previous: { consumption: Number((total.consumption * 0.92).toFixed(3)), cost: null },
  };
}

/** The result a widget would get for `r`, made up from the keys' definitions (`defs`). */
export function sampleResult(r: DataRequest, defs: TelemetryKeyDef[], now = Date.now()): WidgetDataResult {
  const ds = r.datasource;
  const keys = 'keys' in ds ? ds.keys : [];
  const data = (): unknown => {
    if (ds.kind === 'currentDevice') {
      const d = device(0, now);
      switch (r.mode) {
        case 'latest':
          return { device: d, values: values(keys, defs, now) };
        case 'history': {
          const { from, to } = windowOf(r, now);
          const step = Math.max(60_000, Math.round((to - from) / 96));
          const series = Object.fromEntries(
            keys.map((k) => {
              const points: [number, unknown][] = [];
              for (let t = from + step; t <= to; t += step) points.push([t, valueAt(k, defs.find((x) => x.key === k), t)]);
              return [k, points];
            }),
          );
          return { source: to - from > 2 * 24 * HOUR ? '1h' : 'raw', series };
        }
        case 'locations':
          return { devices: [{ ...d, location: location(0, now), values: values(keys, defs, now) }], truncated: false };
        case 'energy':
          return energy(r, defs, now, 1);
        default:
          return null;
      }
    }
    // An asset: a handful of devices.
    const n = 5;
    const devices = Array.from({ length: n }, (_, i) => device(i, now));
    switch (r.mode) {
      case 'stats': {
        const count = (s: DeviceSummary['status']) => devices.filter((d) => d.status === s).length;
        return { total: n, online: count('online'), offline: count('offline'), dead: count('dead'), never: count('never'), messages24h: n * 1440 };
      }
      case 'latest':
        return { devices: devices.map((d, i) => ({ ...d, values: values(keys, defs, now, i) })) };
      case 'locations':
        return { devices: devices.map((d, i) => ({ ...d, location: location(i, now), values: values(keys, defs, now, i) })), truncated: false };
      case 'list':
        return {
          items: devices.map((d, i) => ({ ...d, profileName: null, customerName: null, values: values(keys, defs, now, i) })),
          total: n,
          page: 0,
          pageSize: 25,
        };
      case 'energy':
        return energy(r, defs, now, n);
      default:
        return null;
    }
  };
  return { ok: true, data: data() };
}
