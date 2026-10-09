import type { DeviceProfileDto, TelemetryKeyDef } from '@perspice/shared';

export const keyDef = (profile: DeviceProfileDto | null, key: string): TelemetryKeyDef | undefined =>
  profile?.telemetrySchema.find((k) => k.key === key);

/** "Fuel level (%)" from the profile, else the raw key. */
export function keyLabel(profile: DeviceProfileDto | null, key: string): string {
  const d = keyDef(profile, key);
  if (!d) return key;
  return d.unit ? `${d.label} (${d.unit})` : d.label;
}

export function formatNumber(v: number, decimals?: number, unit?: string): string {
  const text = decimals !== undefined ? v.toFixed(decimals) : String(Math.round(v * 1000) / 1000);
  return unit ? `${text} ${unit}` : text;
}

/** Formats any telemetry value using the key definition (decimals, unit). */
export function formatValue(value: unknown, def?: Pick<TelemetryKeyDef, 'decimals' | 'unit'>): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value, def?.decimals, def?.unit);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return def?.unit ? `${value} ${def.unit}` : value;
  return JSON.stringify(value);
}

export const toNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? Number(v) : null);

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
