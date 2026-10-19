import type { DeviceSummary } from '@perspice/shared';

/** Device status as a tinted capsule with a dot; the word carries the meaning, the colour supports it. */
const STYLE: Record<DeviceSummary['status'], [string, string, string]> = {
  online: ['Online', 'bg-ok-tint text-ok', 'bg-ok-vivid'],
  offline: ['Offline', 'bg-warn-tint text-warn', 'bg-warn-vivid'],
  dead: ['Dead', 'bg-crit-tint text-crit', 'bg-crit-vivid'],
  never: ['Never connected', 'bg-fill text-fg-muted', 'bg-fg-muted'],
};

export function StatusPill({ status }: { status: DeviceSummary['status'] }) {
  const [label, cls, dot] = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
