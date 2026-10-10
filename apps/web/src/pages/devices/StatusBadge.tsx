import type { DeviceStatus } from '@perspice/shared';
import { Badge } from '@/components/ui/badge';

const STYLE: Record<DeviceStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary'; dot: string }> = {
  online: { label: 'Online', variant: 'success', dot: 'bg-green-500' },
  offline: { label: 'Offline', variant: 'warning', dot: 'bg-amber-500' },
  dead: { label: 'Dead', variant: 'danger', dot: 'bg-red-500' },
  never: { label: 'Never connected', variant: 'secondary', dot: 'bg-slate-400' },
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
