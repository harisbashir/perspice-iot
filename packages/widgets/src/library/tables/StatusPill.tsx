import type { DeviceSummary } from '@perspice/shared';

const STYLE: Record<DeviceSummary['status'], [string, string]> = {
  online: ['Online', 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200'],
  offline: ['Offline', 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100'],
  dead: ['Dead', 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'],
  never: ['Never connected', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'],
};

export function StatusPill({ status }: { status: DeviceSummary['status'] }) {
  const [label, cls] = STYLE[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
