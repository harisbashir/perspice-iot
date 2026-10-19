import type { AlarmSeverity, AlarmStatus } from '@perspice/shared';
import { cn } from '@/lib/utils';

/** Same look as the widgets' severity pill: critical filled, the rest tinted, each with a dot. */
const SEVERITY: Record<AlarmSeverity, [string, string]> = {
  critical: ['bg-red-600 text-white', 'bg-white'],
  major: ['bg-crit-tint text-crit', 'bg-crit-vivid'],
  minor: ['bg-warn-tint text-warn', 'bg-warn-vivid'],
  warning: ['bg-info-tint text-info', 'bg-info-vivid'],
};

export function SeverityBadge({ severity, className }: { severity: AlarmSeverity; className?: string }) {
  const [cls, dot] = SEVERITY[severity];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold capitalize', cls, className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {severity}
    </span>
  );
}

const STATUS: Record<AlarmStatus, string> = {
  active: 'text-crit',
  acknowledged: 'text-warn',
  cleared: 'text-fg-muted',
};

export function AlarmStatusText({ status }: { status: AlarmStatus }) {
  return <span className={cn('text-sm font-medium capitalize', STATUS[status])}>{status}</span>;
}
