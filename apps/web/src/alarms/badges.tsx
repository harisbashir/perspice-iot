import type { AlarmSeverity, AlarmStatus } from '@perspice/shared';
import { cn } from '@/lib/utils';

const SEVERITY: Record<AlarmSeverity, string> = {
  critical: 'bg-red-600 text-white',
  major: 'bg-orange-500 text-white',
  minor: 'bg-amber-300 text-amber-950',
  warning: 'bg-sky-200 text-sky-950 dark:bg-sky-900 dark:text-sky-100',
};

export function SeverityBadge({ severity, className }: { severity: AlarmSeverity; className?: string }) {
  return <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase', SEVERITY[severity], className)}>{severity}</span>;
}

const STATUS: Record<AlarmStatus, string> = {
  active: 'text-red-700 dark:text-red-400',
  acknowledged: 'text-amber-700 dark:text-amber-400',
  cleared: 'text-slate-500',
};

export function AlarmStatusText({ status }: { status: AlarmStatus }) {
  return <span className={cn('text-sm font-medium capitalize', STATUS[status])}>{status}</span>;
}
