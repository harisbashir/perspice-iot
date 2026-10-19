import type { AlarmSeverity } from '@perspice/shared';

/** Severity as a tinted capsule with a dot; critical is the only one filled, so it stands out in a list. */
const SEVERITY: Record<AlarmSeverity, [string, string]> = {
  critical: ['bg-red-600 text-white', 'bg-white'],
  major: ['bg-crit-tint text-crit', 'bg-crit-vivid'],
  minor: ['bg-warn-tint text-warn', 'bg-warn-vivid'],
  warning: ['bg-info-tint text-info', 'bg-info-vivid'],
};

export function Severity({ severity }: { severity: AlarmSeverity }) {
  const [cls, dot] = SEVERITY[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {severity}
    </span>
  );
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
