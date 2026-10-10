import type { TelemetryKeyDef } from '@perspice/shared';

/** Formats a telemetry value using the profile's key definition (decimals, unit). */
export function formatValue(value: unknown, def?: TelemetryKeyDef): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    const text = def?.decimals !== undefined ? value.toFixed(def.decimals) : String(value);
    return def?.unit ? `${text} ${def.unit}` : text;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return def?.unit ? `${value} ${def.unit}` : value;
  return JSON.stringify(value);
}

export function timeAgo(ts: number | null, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
