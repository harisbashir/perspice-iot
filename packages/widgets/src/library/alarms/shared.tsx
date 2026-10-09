import type { AlarmSeverity } from '@perspice/shared';

const SEVERITY: Record<AlarmSeverity, string> = {
  critical: 'bg-red-600 text-white',
  major: 'bg-orange-500 text-white',
  minor: 'bg-amber-300 text-amber-950',
  warning: 'bg-sky-200 text-sky-950',
};

export function Severity({ severity }: { severity: AlarmSeverity }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY[severity]}`}>{severity}</span>;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
