import type { DeviceStatus } from '@perspice/shared';
import { Badge } from '@/components/ui/badge';

const STYLE: Record<DeviceStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary'; dot: string }> = {
  online: { label: 'Online', variant: 'success', dot: 'bg-ok-vivid' },
  offline: { label: 'Offline', variant: 'warning', dot: 'bg-warn-vivid' },
  dead: { label: 'Dead', variant: 'danger', dot: 'bg-crit-vivid' },
  never: { label: 'Never connected', variant: 'secondary', dot: 'bg-fg-muted' },
};

/** Colour plus a text label, so status is never conveyed by colour alone. */
export function StatusBadge({ status }: { status: DeviceStatus }) {
  const s = STYLE[status];
  return (
    <Badge variant={s.variant} data-status={status}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </Badge>
  );
}
